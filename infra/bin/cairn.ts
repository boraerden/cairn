#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CairnStack } from "../lib/cairn-stack";

const app = new cdk.App();

const jwtSecret = app.node.tryGetContext("jwtSecret") ?? process.env.CAIRN_JWT_SECRET;
if (!jwtSecret) {
  throw new Error(
    "Provide a JWT secret via `cdk deploy -c jwtSecret=...` or the CAIRN_JWT_SECRET env var.",
  );
}

new CairnStack(app, "CairnStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  jwtSecret,
});
