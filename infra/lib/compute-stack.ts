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

const NOTIFY_USER_FN_NAME = "lembrar-remedio-notify-user";
const SYNC_FN_NAME = "lembrar-remedio-schedule-sync";
const SCHEDULER_ROLE_NAME = "lembrar-remedio-scheduler-invoke";
const TELEGRAM_TOKEN_SECRET_NAME = "lembrar-remedio/telegram-bot-token";

export class ComputeStack extends cdk.Stack {
  public readonly notifyUserFn: nodejs.NodejsFunction;
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
    // NotifyUserFn refers to SchedulerRole (PassRole + env), SchedulerRole refers
    // to NotifyUserFn (grantInvoke). Using known names breaks the dep cycle.
    const notifyUserFnArn = `arn:aws:lambda:${this.region}:${this.account}:function:${NOTIFY_USER_FN_NAME}`;
    const schedulerRoleArn = `arn:aws:iam::${this.account}:role/${SCHEDULER_ROLE_NAME}`;

    // Telegram bot token lives in Secrets Manager (created out-of-band).
    // Lambda fetches at cold start via ensureTelegramToken() in lib/telegram.ts.
    const telegramTokenSecret = sm.Secret.fromSecretNameV2(
      this,
      "TelegramBotTokenSecret",
      TELEGRAM_TOKEN_SECRET_NAME,
    );

    // notify-user Lambda — chamado pelo schedule do usuário, processa todas as
    // doses devidas naquele momento e reagenda pro próximo nextAt.
    this.notifyUserFn = new nodejs.NodejsFunction(this, "NotifyUserFn", {
      functionName: NOTIFY_USER_FN_NAME,
      entry: path.join(projectRoot, "infra/lambda/notify-user/handler.ts"),
      depsLockFilePath: path.join(projectRoot, "infra/package-lock.json"),
      projectRoot,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DDB_TABLE_NAME: props.table.tableName,
        TELEGRAM_BOT_TOKEN_SECRET_ARN: telegramTokenSecret.secretArn,
        NOTIFY_USER_LAMBDA_ARN: notifyUserFnArn,
        SCHEDULER_ROLE_ARN: schedulerRoleArn,
      },
      bundling: commonBundling,
      logRetention: 14 as never,
    });
    props.table.grantReadWriteData(this.notifyUserFn);
    telegramTokenSecret.grantRead(this.notifyUserFn);

    // notify-user reagenda a si própria.
    this.notifyUserFn.addToRolePolicy(
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
    this.notifyUserFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRoleArn],
      }),
    );

    // Role usado pelo EventBridge Scheduler pra invocar a notify-user.
    this.schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      roleName: SCHEDULER_ROLE_NAME,
    });
    this.schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [notifyUserFnArn, `${notifyUserFnArn}:*`],
      }),
    );

    // schedule-sync Lambda — escuta o stream do DDB, mantém o schedule do user.
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
        NOTIFY_USER_LAMBDA_ARN: notifyUserFnArn,
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

    new cdk.CfnOutput(this, "NotifyUserFnArn", { value: this.notifyUserFn.functionArn });
    new cdk.CfnOutput(this, "SyncFnArn", { value: this.syncFn.functionArn });
    new cdk.CfnOutput(this, "SchedulerRoleArn", { value: this.schedulerRole.roleArn });
  }
}
