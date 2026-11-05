import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      service: 'Distributed Wagering Processor',
      status: 'running',
    };
  }
}
