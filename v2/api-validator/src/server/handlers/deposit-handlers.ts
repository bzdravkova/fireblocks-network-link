import { JsonValue } from 'type-fest';
import * as ErrorFactory from '../http-error-factory';
import { FastifyReply, FastifyRequest } from 'fastify';
import { isKnownSubAccount } from '../controllers/accounts-controller';
import { UnknownAdditionalAssetError } from '../controllers/assets-controller';
import { PaginationParams, getPaginationResult } from '../controllers/pagination-controller';
import {
  BadRequestError,
  DepositAddress,
  DepositAddressCreationRequest,
  DepositCapability,
  EntityIdPathParam,
  GeneralError,
  RequestPart,
  SubAccountIdPathParam,
} from '../../client/generated';
import {
  DEPOSIT_METHODS,
  getAccountDepositAddresses,
  DepositAddressNotFoundError,
  registerIdempotencyResponse,
  DepositAddressDisabledError,
  disableAccountDepositAddress,
  addNewDepositAddressForAccount,
  validateDepositAddressCreationRequest,
  depositAddressFromDepositAddressRequest,
  IdempotencyKeyUsedError,
  IdempotencyRequestError,
} from '../controllers/deposit-controller';

type AccountParam = { accountId: SubAccountIdPathParam };

export async function getDepositMethods(
  request: FastifyRequest<{ Querystring: PaginationParams; Params: AccountParam }>,
  reply: FastifyReply
): Promise<{ capabilities: DepositCapability[] }> {
  const { limit, startingAfter, endingBefore } = request.query;
  const { accountId } = request.params;

  if (!isKnownSubAccount(accountId)) {
    return ErrorFactory.notFound(reply);
  }

  return {
    capabilities: getPaginationResult(limit, startingAfter, endingBefore, DEPOSIT_METHODS, 'id'),
  };
}

export async function createDepositAddress(
  request: FastifyRequest<{ Params: AccountParam; Body: DepositAddressCreationRequest }>,
  reply: FastifyReply
): Promise<DepositAddress> {
  const { accountId } = request.params;

  const saveAndSendIdempotentResponse = (responseStatus: number, responseBody: JsonValue) => {
    registerIdempotencyResponse(request.body.idempotencyKey, {
      requestBody: request.body,
      responseStatus,
      responseBody,
    });
    return reply.code(responseStatus).send(responseBody);
  };

  if (!isKnownSubAccount(accountId)) {
    return ErrorFactory.notFound(reply);
  }

  try {
    validateDepositAddressCreationRequest(request.body);
  } catch (err) {
    if (err instanceof UnknownAdditionalAssetError) {
      return saveAndSendIdempotentResponse(400, {
        message: err.message,
        errorType: BadRequestError.errorType.UNKNOWN_ASSET,
        requestPart: RequestPart.BODY,
        propertyName: '/destination/asset/assetId',
      });
    }
    if (err instanceof IdempotencyKeyUsedError) {
      return ErrorFactory.badRequest(reply, {
        message: err.message,
        errorType: BadRequestError.errorType.USED_IDEMPOTENCY_KEY,
      });
    }
    if (err instanceof IdempotencyRequestError) {
      return reply.code(err.metadata.responseStatus).send(err.metadata.responseBody);
    }
    return saveAndSendIdempotentResponse(500, {
      errorType: GeneralError.errorType.INTERNAL_ERROR,
    });
  }

  const depositAddress = depositAddressFromDepositAddressRequest(request.body);

  addNewDepositAddressForAccount(accountId, depositAddress);
  return saveAndSendIdempotentResponse(200, depositAddress);
}

export async function getDepositAddresses(
  request: FastifyRequest<{ Querystring: PaginationParams; Params: AccountParam }>,
  reply: FastifyReply
): Promise<{ addresses: DepositAddress[] }> {
  const { accountId } = request.params;
  const { limit, startingAfter, endingBefore } = request.query;

  if (!isKnownSubAccount(accountId)) {
    return ErrorFactory.notFound(reply);
  }

  const accountDepositAddresses = getAccountDepositAddresses(accountId);

  return {
    addresses: getPaginationResult(
      limit,
      startingAfter,
      endingBefore,
      accountDepositAddresses,
      'id'
    ),
  };
}

export async function getDepositAddressDetails(
  request: FastifyRequest<{ Params: AccountParam & { id: EntityIdPathParam } }>,
  reply: FastifyReply
): Promise<DepositAddress> {
  const { accountId, id: depositAddressId } = request.params;

  if (!isKnownSubAccount(accountId)) {
    return ErrorFactory.notFound(reply);
  }

  const accountDepositAddresses = getAccountDepositAddresses(accountId);
  const depositAddress = accountDepositAddresses.find(
    (depositAddress) => depositAddress.id === depositAddressId
  );

  if (!depositAddress) {
    return ErrorFactory.notFound(reply);
  }

  return depositAddress;
}

export async function disableDepositAddress(
  request: FastifyRequest<{ Params: AccountParam & { id: EntityIdPathParam } }>,
  reply: FastifyReply
): Promise<DepositAddress> {
  const { accountId, id: depositAddressId } = request.params;

  if (!isKnownSubAccount(accountId)) {
    return ErrorFactory.notFound(reply);
  }

  try {
    return disableAccountDepositAddress(accountId, depositAddressId);
  } catch (err) {
    if (err instanceof DepositAddressNotFoundError) {
      return ErrorFactory.notFound(reply);
    }
    if (err instanceof DepositAddressDisabledError) {
      return ErrorFactory.badRequest(reply, {
        message: err.message,
        errorType: BadRequestError.errorType.DEPOSIT_ADDRESS_DISABLED,
      });
    }
    throw err;
  }
}
