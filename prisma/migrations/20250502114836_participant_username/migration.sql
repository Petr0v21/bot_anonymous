/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `participant` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "participant" ALTER COLUMN "username" DROP NOT NULL,
ALTER COLUMN "username" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "participant_username_key" ON "participant"("username");
