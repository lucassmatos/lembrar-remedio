#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { ComputeStack } from "../lib/compute-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const data = new DataStack(app, "LembrarRemedioData", {
  env,
  tableName: "lembrar-remedio",
  vercelIamUserName: "lembrar-remedio-vercel",
});

new ComputeStack(app, "LembrarRemedioCompute", {
  env,
  table: data.table,
});
