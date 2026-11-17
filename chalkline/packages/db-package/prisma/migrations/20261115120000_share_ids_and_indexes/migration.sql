-- AlterTable
-- Added in three steps because existing rooms need a value before the column
-- can be required: nullable, backfilled with a random id each, then NOT NULL.
ALTER TABLE "public"."Room" ADD COLUMN     "shareId" TEXT;

UPDATE "public"."Room" SET "shareId" = gen_random_uuid()::text WHERE "shareId" IS NULL;

ALTER TABLE "public"."Room" ALTER COLUMN "shareId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Room_shareId_key" ON "public"."Room"("shareId");

-- CreateIndex
CREATE INDEX "Room_adminId_idx" ON "public"."Room"("adminId");

-- CreateIndex
CREATE INDEX "RoomMember_userId_idx" ON "public"."RoomMember"("userId");

-- CreateIndex
CREATE INDEX "File_userId_idx" ON "public"."File"("userId");

-- CreateIndex
CREATE INDEX "Shape_roomId_createdAt_idx" ON "public"."Shape"("roomId", "createdAt");
