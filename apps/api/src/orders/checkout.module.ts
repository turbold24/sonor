import { Module } from '@nestjs/common';
import { MessengerModule } from '../messenger/messenger.module.js';
import { CheckoutController } from './checkout.controller.js';
import { OrdersModule } from './orders.module.js';

// Separate from OrdersModule so the agent can use orders without depending on Messenger.
@Module({
  imports: [OrdersModule, MessengerModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
