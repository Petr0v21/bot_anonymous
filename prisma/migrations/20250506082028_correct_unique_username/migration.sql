/*
  Warnings:

  - A unique constraint covering the columns `[username,room_id]` on the table `participant` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "participant_username_key";

-- CreateIndex
CREATE UNIQUE INDEX "participant_username_room_id_key" ON "participant"("username", "room_id");
