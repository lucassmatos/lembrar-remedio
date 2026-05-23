#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { CronStack } from "../lib/cron-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

new DataStack(app, "LembrarRemedioData", {
  env,
  tableName: "lembrar-remedio",
  vercelIamUserName: "lembrar-remedio-vercel",
});

const cronUrl = process.env.CRON_URL || app.node.tryGetContext("cronUrl");
const appSecret = process.env.APP_SECRET || app.node.tryGetContext("appSecret");
const rateMinutes = Number(
  process.env.CRON_RATE_MIN || app.node.tryGetContext("rateMinutes") || 1,
);

if (cronUrl && appSecret) {
  new CronStack(app, "LembrarRemedioCron", {
    env,
    cronUrl,
    appSecret,
    rateMinutes,
  });
}
