import * as path from "path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigatewayv2 as apigwv2,
  aws_apigatewayv2_integrations as apigwv2_int,
  aws_cloudfront as cf,
  aws_cloudfront_origins as cfo,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNode,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export interface CairnStackProps extends StackProps {
  jwtSecret: string;
}

export class CairnStack extends Stack {
  constructor(scope: Construct, id: string, props: CairnStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "DataBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });

    const backendRoot = path.resolve(__dirname, "..", "..", "backend");
    const fn = new lambdaNode.NodejsFunction(this, "ApiHandler", {
      entry: path.join(backendRoot, "src/handler.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 512,
      timeout: Duration.seconds(15),
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: "node20",
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
      environment: {
        CAIRN_BUCKET: bucket.bucketName,
        JWT_SECRET: props.jwtSecret,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });

    bucket.grantReadWrite(fn);

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"],
        allowHeaders: ["authorization", "content-type", "if-match"],
        exposeHeaders: ["etag"],
        maxAge: Duration.hours(1),
      },
    });

    const integration = new apigwv2_int.HttpLambdaIntegration("LambdaInt", fn);
    httpApi.addRoutes({ path: "/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration });
    httpApi.addRoutes({ path: "/", methods: [apigwv2.HttpMethod.ANY], integration });

    const oac = new cf.S3OriginAccessControl(this, "SiteOAC");
    const siteOrigin = cfo.S3BucketOrigin.withOriginAccessControl(bucket, {
      originAccessControl: oac,
      originPath: "/site",
    });

    const distribution = new cf.Distribution(this, "SiteDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: siteOrigin,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(1) },
      ],
    });

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects("site/*")],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    const frontendDist = path.resolve(__dirname, "..", "..", "frontend", "dist");
    new s3deploy.BucketDeployment(this, "SiteDeployment", {
      sources: [s3deploy.Source.asset(frontendDist, { exclude: [".DS_Store"] })],
      destinationBucket: bucket,
      destinationKeyPrefix: "site",
      distribution,
      distributionPaths: ["/*"],
      prune: true,
    });

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
