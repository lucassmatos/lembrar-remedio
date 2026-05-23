import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as scheduler from "aws-cdk-lib/aws-scheduler";

export interface CronStackProps extends cdk.StackProps {
  cronUrl: string;
  appSecret: string;
  rateMinutes: number;
}

export class CronStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CronStackProps) {
    super(scope, id, props);

    const connection = new events.Connection(this, "VercelConnection", {
      connectionName: "lembrar-remedio-vercel",
      authorization: events.Authorization.apiKey(
        "Authorization",
        cdk.SecretValue.unsafePlainText(`Bearer ${props.appSecret}`),
      ),
      description: "Hits the Vercel cron endpoint with the shared bearer secret",
    });

    const destination = new events.ApiDestination(this, "VercelDestination", {
      apiDestinationName: "lembrar-remedio-cron",
      connection,
      endpoint: props.cronUrl,
      httpMethod: events.HttpMethod.POST,
    });

    const role = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["events:InvokeApiDestination"],
        resources: [destination.apiDestinationArn],
      }),
    );

    new scheduler.CfnSchedule(this, "NotifySchedule", {
      name: "lembrar-remedio-notify",
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: `rate(${props.rateMinutes} minute${props.rateMinutes === 1 ? "" : "s"})`,
      scheduleExpressionTimezone: "UTC",
      state: "ENABLED",
      target: {
        arn: destination.apiDestinationArn,
        roleArn: role.roleArn,
        retryPolicy: {
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 120,
        },
      },
    });

    new cdk.CfnOutput(this, "ApiDestinationArn", { value: destination.apiDestinationArn });
    new cdk.CfnOutput(this, "ScheduleName", { value: "lembrar-remedio-notify" });
  }
}
