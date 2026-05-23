import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export interface DataStackProps extends cdk.StackProps {
  tableName: string;
  vercelIamUserName: string;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "Table", {
      tableName: props.tableName,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const vercelUser = new iam.User(this, "VercelUser", {
      userName: props.vercelIamUserName,
    });
    this.table.grantReadWriteData(vercelUser);

    const accessKey = new iam.AccessKey(this, "VercelAccessKey", {
      user: vercelUser,
    });

    const credsSecret = new secretsmanager.Secret(this, "VercelCreds", {
      secretName: "lembrar-remedio/vercel-iam",
      description: "IAM access key for Vercel to read/write the DynamoDB table",
      secretObjectValue: {
        AWS_ACCESS_KEY_ID: cdk.SecretValue.unsafePlainText(accessKey.accessKeyId),
        AWS_SECRET_ACCESS_KEY: accessKey.secretAccessKey,
      },
    });

    new cdk.CfnOutput(this, "TableName", { value: this.table.tableName });
    new cdk.CfnOutput(this, "TableArn", { value: this.table.tableArn });
    new cdk.CfnOutput(this, "VercelCredsSecretName", {
      value: credsSecret.secretName,
      description:
        "Run: aws secretsmanager get-secret-value --secret-id <this> --query SecretString --output text | jq",
    });
  }
}
