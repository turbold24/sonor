import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, type AgentReply } from '../agent/agent.service.js';
import { ConversationService } from '../agent/conversation.service.js';
import { downloadPhoto, PhotoError } from '../common/photos.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface DevChatRequest {
  tenantSlug: string;
  customerRef: string;
  /** May be empty when imageUrl is set. */
  text: string;
  /** An https photo, downloaded and sent like a Messenger photo. */
  imageUrl?: string;
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
    this.assertNotProduction();
    const { tenantSlug, customerRef, text, imageUrl } = parseRequest(body);

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) throw new NotFoundException(`No tenant "${tenantSlug}"`);

    // Prefixed so dev customers can never collide with real Messenger PSIDs.
    const conversation = await this.conversations.findOrStart(
      tenant.id,
      `dev:${customerRef}`,
    );
    const images = imageUrl
      ? [
          await downloadPhoto(imageUrl).catch((error: unknown) => {
            if (error instanceof PhotoError) {
              throw new BadRequestException(`image not read: ${error.message}`);
            }
            throw error;
          }),
        ]
      : [];
    const reply = await this.agent.reply(
      tenant.id,
      conversation.id,
      text,
      imageUrl
        ? { attachments: [{ type: 'image', payload: { url: imageUrl } }] }
        : {},
      images,
    );
    return { conversationId: conversation.id, ...reply };
  }

  /** Lets the bot answer again in a conversation paused by a handoff or the owner. */
  @Post('conversations/:conversationId/resume')
  @HttpCode(200)
  async resume(
    @Param('conversationId') conversationId: string,
  ): Promise<{ conversationId: string; resumed: true }> {
    this.assertNotProduction();
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { tenantId: true },
    });
    if (
      !conversation ||
      !(await this.conversations.resume(conversation.tenantId, conversationId))
    ) {
      throw new NotFoundException('Conversation not found');
    }
    return { conversationId, resumed: true };
  }

  private assertNotProduction(): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
  }
}

function parseRequest(body: unknown): DevChatRequest {
  const value = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;
  const { tenantSlug, customerRef, text = '', imageUrl } = value;
  if (typeof tenantSlug !== 'string' || !tenantSlug) {
    throw new BadRequestException('tenantSlug is required');
  }
  if (typeof customerRef !== 'string' || !/^[\w.-]{1,64}$/.test(customerRef)) {
    throw new BadRequestException(
      'customerRef must be 1-64 letters, digits, _ . or -',
    );
  }
  if (
    imageUrl !== undefined &&
    (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://'))
  ) {
    throw new BadRequestException('imageUrl must be an https URL');
  }
  if (
    typeof text !== 'string' ||
    (!text.trim() && !imageUrl) ||
    text.length > 2000
  ) {
    throw new BadRequestException(
      'text must be 1-2000 characters (or empty with imageUrl)',
    );
  }
  return { tenantSlug, customerRef, text: text.trim(), imageUrl };
}
