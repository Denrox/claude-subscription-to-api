import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { TokensService } from "./tokens.service";

@Controller("tokens")
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  list() {
    return { tokens: this.tokens.list() };
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: any) {
    const { token, view } = this.tokens.create({
      name: body?.name,
      expiresInDays: body?.expiresInDays,
    });
    return { token, ...view };
  }

  @Post(":id/revoke")
  @HttpCode(200)
  revoke(@Param("id") id: string) {
    return this.tokens.revoke(id);
  }

  @Delete(":id")
  @HttpCode(200)
  remove(@Param("id") id: string) {
    return this.tokens.remove(id);
  }
}
