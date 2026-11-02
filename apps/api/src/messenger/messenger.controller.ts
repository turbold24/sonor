import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { MESSENGER_CONFIG, type MessengerConfig } from './messenger.config.js';
import { MessengerService } from './messenger.service.js';
import { safeEqual, verifySignature } from './signature.js';

@Controller('webhooks/messenger')
export class MessengerController {
  private readonly logger = new Logger(MessengerController.name);

  constructor(
    @Inject(MESSENGER_CONFIG) private readonly config: MessengerConfig,
    private readonly messenger: MessengerService,
  ) {}

  /** Meta's verification handshake when the webhook URL is saved. */
  @Get()
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') token: unknown,
    @Query('hub.challenge') challenge: unknown,
  ): string {
    if (
      mode === 'subscribe' &&
      typeof challenge === 'string' &&
      typeof token === 'string' &&
      safeEqual(token, this.config.verifyToken)
    ) {
      return challenge;
    }
    throw new ForbiddenException();
  }

  /** Checks the signature over the raw body, answers 200 at once, then processes events. */
  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): string {
    if (!verifySignature(request.rawBody, signature, this.config.appSecret)) {
      if (!this.config.appSecret) {
        this.logger.error('MESSENGER_APP_SECRET is not set; rejecting webhook');
      }
      throw new ForbiddenException('Invalid signature');
    }
    this.messenger.accept(request.body);
    return 'EVENT_RECEIVED';
  }
}
