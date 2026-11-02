import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, type AgentReply } from '../agent/agent.service.js';
import { ConversationService } from '../agent/conversation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface DevChatRequest {
  tenantSlug: string;
  customerRef: string;
  text: string;
}

export interface DevChatResponse extends AgentReply {
  conversationId: string;
}

// Local test path for the agent without Messenger. Never available in production:
// DevModule isn't registered there, and this handler refuses as a second guard.
@Controller('dev')
export class DevController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly agent: AgentService,
  ) {}

  @Post('chat')
  @HttpCode(200)
  async chat(@Body() body: unknown): Promise<DevChatResponse> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
    const { tenantSlug, customerRef, text } = parseRequest(body);

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) throw new NotFoundException(`No tenant "${tenantSlug}"`);

    // Prefixed so dev customers can never collide with real Messenger PSIDs.
    const conversation = await this.conversations.findOrStart(
      tenant.id,
      `dev:${customerRef}`,
    );
    const reply = await this.agent.reply(tenant.id, conversation.id, text);
    return { conversationId: conversation.id, ...reply };
  }
}

function parseRequest(body: unknown): DevChatRequest {
  const value = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;
  const { tenantSlug, customerRef, text } = value;
  if (typeof tenantSlug !== 'string' || !tenantSlug) {
    throw new BadRequestException('tenantSlug is required');
  }
  if (typeof customerRef !== 'string' || !/^[\w.-]{1,64}$/.test(customerRef)) {
    throw new BadRequestException(
      'customerRef must be 1-64 letters, digits, _ . or -',
    );
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
    throw new BadRequestException('text must be 1-2000 characters');
  }
  return { tenantSlug, customerRef, text: text.trim() };
}
