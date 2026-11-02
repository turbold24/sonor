import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
