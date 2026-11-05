# Dependências

bun add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjsbun add @mikro-orm/core @mikro-orm/nestjs @mikro-orm/postgresql @mikro-orm/migrations
bun add @mikro-orm/core @mikro-orm/nestjs @mikro-orm/postgresql @mikro-orm/migrations
bun add decimal.js @aws-sdk/client-sqs pino nestjs-pino prom-client zod
bun add -d typescript @types/bun @mikro-orm/cli

# Stack

## Bun

Runtime, package manager, test runnet e bundler de JavaScript e TypeScript (como Node.js)

- ```powershell -c "irm bun.sh/install.ps1 | iex"```: instala bun.
- ```bun --version```:versão do bun.
- ```bun init -y```: inicializa o projeto (cria package.json).

## NestJS

- ```bun add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs```: instalação.

## MikroORM

- ```bun add @mikro-orm/core @mikro-orm/nestjs @mikro-orm/postgresql @mikro-orm/migrations```: instalação.
- ```bun add -d @mikro-orm/cli```: instalação CLI.

## Bibliotecas Complementares
- ```bun add decimal.js @aws-sdk/client-sqs pino nestjs-pino prom-client zod```.
- ```bun add -d typescript @types/bun```: dependências de desenvolvimento.