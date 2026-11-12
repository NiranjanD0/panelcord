-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "panel_connections" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "panel_url" TEXT NOT NULL,
    "encrypted_api_key" TEXT NOT NULL,
    "encryption_iv" TEXT NOT NULL,
    "encryption_auth_tag" TEXT NOT NULL,
    "encryption_key_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "panel_connections_guild_id_idx" ON "panel_connections"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "panel_connections_guild_id_name_key" ON "panel_connections"("guild_id", "name");
