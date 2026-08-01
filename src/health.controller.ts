import { Controller, Get } from "@nestjs/common";

// Unauthenticated on purpose (see the middleware's public list) so a container
// healthcheck or uptime probe works without holding a session. It reveals
// nothing beyond "the process is up".
@Controller("health")
export class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}
