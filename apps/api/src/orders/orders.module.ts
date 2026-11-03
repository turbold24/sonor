import { Module } from '@nestjs/common';
import { OrderService } from './order.service.js';

@Module({
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
