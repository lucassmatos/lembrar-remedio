import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

export interface ComputeStackProps extends cdk.StackProps {
  table: dynamodb.Table;
}

const NOTIFY_DOSE_FN_NAME = "lembrar-remedio-notify-dose";
const NOTIFY_BIRTHDAYS_FN_NAME = "lembrar-remedio-notify-birthdays";
const SYNC_FN_NAME = "lembrar-remedio-schedule-sync";
const SCHEDULER_ROLE_NAME = "lembrar-remedio-scheduler-invoke";
const TELEGRAM_TOKEN_SECRET_NAME = "lembrar-remedio/telegram-bot-token";
const VAPID_PRIVATE_KEY_SECRET_NAME = "lembrar-remedio/vapid-private-key";

export class ComputeStack extends cdk.Stack {
  public readonly notifyDoseFn: nodejs.NodejsFunction;
  public readonly notifyBirthdaysFn: nodejs.NodejsFunction;
  public readonly syncFn: nodejs.NodejsFunction;
  public readonly schedulerRole: iam.Role;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const projectRoot = path.resolve(__dirname, "../..");

    const commonBundling: nodejs.BundlingOptions = {
      externalModules: ["@aws-sdk/*"],
      minify: false,
      sourceMap: true,
      target: "node20",
      format: nodejs.OutputFormat.CJS,
    };

    // Constructed statically to avoid CDK self-reference cycles.
    // NotifyDoseFn refers to SchedulerRole (PassRole + env), SchedulerRole refers
    // to NotifyDoseFn (grantInvoke). Using known names breaks the dep cycle.
    // Mesma dança pro NotifyBirthdaysFn — SchedulerRole precisa invocá-lo, e a
    // syncFn precisa do ARN no env pra criar o schedule.
    const notifyDoseFnArn = `arn:aws:lambda:${this.region}:${this.account}:function:${NOTIFY_DOSE_FN_NAME}`;
    const notifyBirthdaysFnArn = `arn:aws:lambda:${this.region}:${this.account}:function:${NOTIFY_BIRTHDAYS_FN_NAME}`;
    const schedulerRoleArn = `arn:aws:iam::${this.account}:role/${SCHEDULER_ROLE_NAME}`;

    // Telegram bot token lives in Secrets Manager (created out-of-band).
    // Lambda fetches at cold start via ensureTelegramToken() in lib/telegram.ts.
    const telegramTokenSecret = sm.Secret.fromSecretNameV2(
      this,
      "TelegramBotTokenSecret",
      TELEGRAM_TOKEN_SECRET_NAME,
    );
    // Web Push (VAPID) private key — loaded at cold start via ensureVapid() in
    // lib/push.ts. Public key is hardcoded (client-safe) in lib/vapid-public.ts.
    const vapidPrivateKeySecret = sm.Secret.fromSecretNameV2(
      this,
      "VapidPrivateKeySecret",
      VAPID_PRIVATE_KEY_SECRET_NAME,
    );

    // notify-dose Lambda — chamado pelo schedule do perfil, processa todas as
    // doses devidas naquele momento e reagenda pro próximo nextAt.
    this.notifyDoseFn = new nodejs.NodejsFunction(this, "NotifyDoseFn", {
      functionName: NOTIFY_DOSE_FN_NAME,
      entry: path.join(projectRoot, "infra/lambda/notify-dose/handler.ts"),
      depsLockFilePath: path.join(projectRoot, "infra/package-lock.json"),
      projectRoot,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DDB_TABLE_NAME: props.table.tableName,
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramTokenSecret.secretArn,
        VAPID_PRIVATE_KEY_SECRET_ARN: vapidPrivateKeySecret.secretArn,
        NOTIFY_DOSE_LAMBDA_ARN: notifyDoseFnArn,
        SCHEDULER_ROLE_ARN: schedulerRoleArn,
      },
      bundling: commonBundling,
      logRetention: 14 as never,
    });
    props.table.grantReadWriteData(this.notifyDoseFn);
    telegramTokenSecret.grantRead(this.notifyDoseFn);
    vapidPrivateKeySecret.grantRead(this.notifyDoseFn);

    // notify-dose reagenda a si própria.
    this.notifyDoseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
        ],
        resources: ["*"],
      }),
    );
    this.notifyDoseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRoleArn],
      }),
    );

    // notify-birthdays Lambda — disparado pelo schedule diário de cada usuário,
    // monta o digest (hoje + opcional semana/mês) e manda Telegram + Web Push
    // pro próprio usuário. Sem fan-out: cada parceiro tem seu próprio schedule.
    this.notifyBirthdaysFn = new nodejs.NodejsFunction(this, "NotifyBirthdaysFn", {
      functionName: NOTIFY_BIRTHDAYS_FN_NAME,
      entry: path.join(projectRoot, "infra/lambda/notify-birthdays/handler.ts"),
      depsLockFilePath: path.join(projectRoot, "infra/package-lock.json"),
      projectRoot,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DDB_TABLE_NAME: props.table.tableName,
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramTokenSecret.secretArn,
        VAPID_PRIVATE_KEY_SECRET_ARN: vapidPrivateKeySecret.secretArn,
      },
      bundling: commonBundling,
      logRetention: 14 as never,
    });
    props.table.grantReadWriteData(this.notifyBirthdaysFn);
    telegramTokenSecret.grantRead(this.notifyBirthdaysFn);
    vapidPrivateKeySecret.grantRead(this.notifyBirthdaysFn);

    // Role usado pelo EventBridge Scheduler pra invocar as duas Lambdas
    // (notify-dose, notify-birthdays).
    this.schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      roleName: SCHEDULER_ROLE_NAME,
    });
    this.schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          notifyDoseFnArn,
          `${notifyDoseFnArn}:*`,
          notifyBirthdaysFnArn,
          `${notifyBirthdaysFnArn}:*`,
        ],
      }),
    );

    // schedule-sync Lambda — escuta o stream do DDB, mantém o schedule do perfil.
    this.syncFn = new nodejs.NodejsFunction(this, "SyncFn", {
      functionName: SYNC_FN_NAME,
      entry: path.join(projectRoot, "infra/lambda/schedule-sync/handler.ts"),
      depsLockFilePath: path.join(projectRoot, "infra/package-lock.json"),
      projectRoot,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        DDB_TABLE_NAME: props.table.tableName,
        NOTIFY_DOSE_LAMBDA_ARN: notifyDoseFnArn,
        NOTIFY_BIRTHDAYS_LAMBDA_ARN: notifyBirthdaysFnArn,
        SCHEDULER_ROLE_ARN: schedulerRoleArn,
      },
      bundling: commonBundling,
      logRetention: 14 as never,
    });
    props.table.grantReadData(this.syncFn);

    this.syncFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
        ],
        resources: ["*"],
      }),
    );
    this.syncFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRoleArn],
      }),
    );

    this.syncFn.addEventSource(
      new sources.DynamoEventSource(props.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
        bisectBatchOnError: true,
        maxBatchingWindow: cdk.Duration.seconds(1),
      }),
    );

    new cdk.CfnOutput(this, "NotifyDoseFnArn", { value: this.notifyDoseFn.functionArn });
    new cdk.CfnOutput(this, "NotifyBirthdaysFnArn", { value: this.notifyBirthdaysFn.functionArn });
    new cdk.CfnOutput(this, "SyncFnArn", { value: this.syncFn.functionArn });
    new cdk.CfnOutput(this, "SchedulerRoleArn", { value: this.schedulerRole.roleArn });
  }
}
