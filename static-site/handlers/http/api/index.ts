import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";

export const get = async (
  _event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyResultV2> => {
  return {
    body: JSON.stringify({ msg: "hello from AWS Lambda" }),
    statusCode: 200,
  };
};
