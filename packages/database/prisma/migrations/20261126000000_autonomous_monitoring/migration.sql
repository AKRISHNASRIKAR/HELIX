-- AlterTable
ALTER TABLE "investigations" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "monitorId" TEXT,
ADD COLUMN     "triggerContext" JSONB;

-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "timeColumn" TEXT NOT NULL,
    "valueColumn" TEXT,
    "aggregation" TEXT NOT NULL,
    "filter" JSONB,
    "unit" TEXT,
    "minSeverity" "AnomalySeverity" NOT NULL DEFAULT 'HIGH',
    "lookbackDays" INTEGER NOT NULL DEFAULT 7,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitors_organizationId_idx" ON "monitors"("organizationId");

-- CreateIndex
CREATE INDEX "monitors_enabled_idx" ON "monitors"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "investigations_dedupeKey_key" ON "investigations"("dedupeKey");

-- CreateIndex
CREATE INDEX "investigations_monitorId_idx" ON "investigations"("monitorId");

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

