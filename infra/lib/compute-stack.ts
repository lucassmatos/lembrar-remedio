import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sources from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";

export interface ComputeStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  telegramBotToken: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly notifyFn: nodejs.NodejsFunction;
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

    // Notify Lambda — chamado pelos schedules, manda 1 mensagem no Telegram
    this.notifyFn = new nodejs.NodejsFunction(this, "NotifyFn", {
      functionName: "lembrar-remedio-notify",
      entry: path.join(projectRoot, "infra/lambda/notify/handler.ts"),
      depsLockFilePath: path.join(projectRoot, "infra/package-lock.json"),
      projectRoot,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        DDB_TABLE_NAME: props.table.tableName,
        TELEGRAM_BOT_TOKEN: props.telegramBotToken,
      },
      bundling: commonBundling,
      logRetention: 14 as never,
    });
    props.table.grantReadWriteData(this.notifyFn);

    // IAM role pro EventBridge Scheduler invocar a notify
    this.schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      roleName: "lembrar-remedio-scheduler-invoke",
    });
    this.notifyFn.grantInvoke(this.schedulerRole);

    // Sync Lambda — escuta o stream do DDB, atualiza schedules
    this.syncFn = new nodejs.NodejsFunction(this, "SyncFn", {
      functionName: "lembrar-remedio-schedule-sync",
      entry: path.join(projectRoot, "infra/lambda/schedule-sync/handler.ts"),
      depsLockFilePath: path.join(projectRoot, "infra/package-lock.json"),
      projectRoot,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        DDB_TABLE_NAME: props.table.tableName,
        NOTIFY_LAMBDA_ARN: this.notifyFn.functionArn,
        SCHEDULER_ROLE_ARN: this.schedulerRole.roleArn,
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
        resources: [this.schedulerRole.roleArn],
      }),
    );

    // DDB stream → SyncFn
    this.syncFn.addEventSource(
      new sources.DynamoEventSource(props.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
        bisectBatchOnError: true,
        maxBatchingWindow: cdk.Duration.seconds(1),
      }),
    );

    new cdk.CfnOutput(this, "NotifyFnArn", { value: this.notifyFn.functionArn });
    new cdk.CfnOutput(this, "SyncFnArn", { value: this.syncFn.functionArn });
    new cdk.CfnOutput(this, "SchedulerRoleArn", { value: this.schedulerRole.roleArn });
  }
}
