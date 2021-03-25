import * as cdk from "@aws-cdk/core";
import * as lambda from "@aws-cdk/aws-lambda";
import * as lambdaNode from "@aws-cdk/aws-lambda-nodejs";
import * as path from "path";
import * as apigw from "@aws-cdk/aws-apigateway";
import * as s3 from "@aws-cdk/aws-s3";
import * as s3Deployment from "@aws-cdk/aws-s3-deployment";
import * as cloudfront from "@aws-cdk/aws-cloudfront";
import * as iam from "@aws-cdk/aws-iam";

export class StaticSiteStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a Lambda function.
    const versionNumber = new Date().toISOString();
    const apiGetHandler = new lambdaNode.NodejsFunction(
      this,
      "apiGetHandler",
      {
        runtime: lambda.Runtime.NODEJS_12_X,
        handler: "get",
        entry: path.join(__dirname, "../handlers/http/api/index.ts"),
        memorySize: 1024,
        description: `Build time: ${versionNumber}`,
      }
    );
    const apiGateway = new apigw.LambdaRestApi(this, "apiGateway", {
      handler: apiGetHandler,
    });

    // Create a bucket for static content.
    const staticBucket = new s3.Bucket(this, "staticBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
        { noncurrentVersionExpiration: cdk.Duration.days(7) },
      ],
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      versioned: true,
    });

    // Deploy the static resources.
    new s3Deployment.BucketDeployment(this, "staticBucketDeployment", {
      sources: [
        s3Deployment.Source.asset(path.join(__dirname, "../root")),
      ],
      destinationKeyPrefix: "/",
      destinationBucket: staticBucket,
    });

    // Create a CloudFront distribution connected to the Lambda and the static content.
    const cfOriginAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "cfOriginAccessIdentity",
      {}
    );
    const cloudfrontS3Access = new iam.PolicyStatement();
    cloudfrontS3Access.addActions("s3:GetBucket*");
    cloudfrontS3Access.addActions("s3:GetObject*");
    cloudfrontS3Access.addActions("s3:List*");
    cloudfrontS3Access.addResources(staticBucket.bucketArn);
    cloudfrontS3Access.addResources(`${staticBucket.bucketArn}/*`);
    cloudfrontS3Access.addCanonicalUserPrincipal(
      cfOriginAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId
    );
    staticBucket.addToResourcePolicy(cloudfrontS3Access);

    const corsLambda = new cloudfront.experimental.EdgeFunction(
      this,
      "corsLambda",
      {
        code: lambda.Code.fromAsset(path.join(__dirname, "./cloudfront")),
        handler: "cors.onOriginResponse",
        runtime: lambda.Runtime.NODEJS_12_X,
      }
    );

    // Create distribution.
    new cloudfront.CloudFrontWebDistribution(this, "webDistribution", {
      originConfigs: [
        {
          customOriginSource: {
            domainName: `${apiGateway.restApiId}.execute-api.${this.region}.${this.urlSuffix}`,
          },
          originPath: `/${apiGateway.deploymentStage.stageName}`,
          behaviors: [
            {
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
              pathPattern: "api/*",
            },
          ],
        },
        {
          s3OriginSource: {
            s3BucketSource: staticBucket,
            originAccessIdentity: cfOriginAccessIdentity,
          },
          behaviors: [
            {
              lambdaFunctionAssociations: [
                {
                  lambdaFunction: corsLambda,
                  eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
                },
              ],
              isDefaultBehavior: true,
            },
          ],
        },
      ],
    });
  }
}
