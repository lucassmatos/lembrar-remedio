import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

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

    const rule = new events.Rule(this, "NotifyRule", {
      ruleName: "lembrar-remedio-notify",
      schedule: events.Schedule.rate(cdk.Duration.minutes(props.rateMinutes)),
      description: "Fires the Vercel cron notify endpoint",
    });
    rule.addTarget(
      new targets.ApiDestination(destination, {
        retryAttempts: 2,
        maxEventAge: cdk.Duration.minutes(2),
      }),
    );

    new cdk.CfnOutput(this, "ApiDestinationArn", { value: destination.apiDestinationArn });
    new cdk.CfnOutput(this, "RuleName", { value: "lembrar-remedio-notify" });
  }
}
