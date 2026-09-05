-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EmployeeLevel" AS ENUM ('TRAINEE', 'ASSOCIATE', 'SENIOR', 'LEAD', 'ARTICLE', 'EXECUTIVE', 'SENIOR_EXECUTIVE', 'ASSISTANT_MANAGER', 'MANAGER', 'SENIOR_MANAGER', 'PARTNER');

-- CreateEnum
CREATE TYPE "Department" AS ENUM ('AUDIT', 'TAX', 'ACCOUNTS', 'ROC', 'TECH', 'ADMIN', 'GENERAL');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'ADMIN');

-- CreateEnum
CREATE TYPE "DeadlineKind" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('VIDEO', 'MODULE', 'TASK');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TrackKind" AS ENUM ('MASTERY', 'DELIVERY', 'INITIATIVE', 'COLLABORATION', 'VISION', 'CRAFT');

-- CreateEnum
CREATE TYPE "TierKind" AS ENUM ('STELLAR', 'SOARING', 'SOLID', 'GROWING', 'FOCUSED', 'RECALIBRATING');

-- CreateEnum
CREATE TYPE "QuestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('PITCHED', 'FUNDED', 'ACTIVE', 'SHIPPED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('UPVOTE', 'INTERESTED');

-- CreateEnum
CREATE TYPE "EndorsementKind" AS ENUM ('COLLABORATION', 'INITIATIVE', 'MENTORSHIP', 'CROSS_DEPT', 'CRAFT');

-- CreateEnum
CREATE TYPE "LiveSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'RECORDING_READY', 'INGESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('INDIVIDUAL', 'HUF', 'PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PVT_LTD', 'PUBLIC_LTD', 'TRUST_SOCIETY', 'OTHER');

-- CreateEnum
CREATE TYPE "TurnoverBand" AS ENUM ('UNDER_40L', 'L40_TO_1CR', 'CR1_TO_5CR', 'CR5_TO_20CR', 'ABOVE_20CR');

-- CreateEnum
CREATE TYPE "GrowthGoal" AS ENUM ('EXPAND_LOCATIONS', 'RAISE_FUNDING', 'CONVERT_ENTITY', 'EXPORT', 'COMPLIANCE_CLEANUP', 'COST_REDUCTION', 'EXIT_SALE', 'MAINTAIN', 'OTHER');

-- CreateEnum
CREATE TYPE "FolderStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DELIVERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClientDocType" AS ENUM ('PAN', 'AADHAAR_DIN', 'INCORPORATION_DEED', 'GST_CERT', 'MOA_AOA', 'BANK', 'ENGAGEMENT_LETTER', 'OTHER_KYC', 'SOURCE_DATA', 'WORKING_PAPERS', 'FILED_RETURN', 'ACKNOWLEDGEMENT', 'SIGN_OFF', 'OTHER_JOB');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('INBOX', 'ACTIVE', 'PARKED', 'DONE', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "WorkTaskStatus" AS ENUM ('TODO', 'DONE', 'DROPPED');

-- CreateEnum
CREATE TYPE "DayPickOutcome" AS ENUM ('DONE', 'CARRIED');

-- CreateEnum
CREATE TYPE "WorkEventKind" AS ENUM ('WORK_CREATED', 'WORK_STATUS', 'WORK_REOPENED', 'TASK_CREATED', 'TASK_DONE', 'TASK_DROPPED', 'TASK_REVIEWED', 'TASK_REOPENED', 'PICKED', 'CARRIED', 'AUTO_PAUSED', 'WEEK_PLANNED', 'WEEK_REVIEWED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "level" "EmployeeLevel" NOT NULL DEFAULT 'EXECUTIVE',
    "department" "Department" NOT NULL DEFAULT 'GENERAL',
    "branchId" TEXT,
    "managerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "excludedFromScoring" BOOLEAN NOT NULL DEFAULT false,
    "strengths" JSONB,
    "aspiration" TEXT,
    "wizardSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,

    CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "groupName" TEXT,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceText" TEXT,
    "graphDriveId" TEXT NOT NULL,
    "graphItemId" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "graphDriveId" TEXT NOT NULL,
    "graphItemId" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastPosition" INTEGER NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timeLimitSec" INTEGER NOT NULL DEFAULT 300,
    "passPercent" INTEGER NOT NULL DEFAULT 70,
    "maxAttempts" INTEGER,
    "unlockAtPercent" INTEGER NOT NULL DEFAULT 90,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "quizTimeLimitSec" INTEGER NOT NULL DEFAULT 600,
    "quizPassPercent" INTEGER NOT NULL DEFAULT 70,
    "quizUnlockAtPercent" INTEGER NOT NULL DEFAULT 90,
    "workTeamsChatId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Option" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "maxScore" INTEGER NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "answers" JSONB,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" "DeadlineKind" NOT NULL DEFAULT 'CUSTOM',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "pointsOnTime" INTEGER NOT NULL DEFAULT 10,
    "pointsLate" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL,
    "videoId" TEXT,
    "moduleId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "autoGenerated" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "workingDays" DOUBLE PRECISION NOT NULL,
    "presentDays" DOUBLE PRECISION NOT NULL,
    "lateMarks" INTEGER NOT NULL DEFAULT 0,
    "attendancePct" DOUBLE PRECISION NOT NULL,
    "points" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'greytHR',
    "note" TEXT,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackTarget" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "trackKind" "TrackKind" NOT NULL,
    "level" "EmployeeLevel" NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "TrackTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "why" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "status" "QuestStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestMilestone" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QuestMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Initiative" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "impact" TEXT,
    "status" "InitiativeStatus" NOT NULL DEFAULT 'PITCHED',
    "fundedById" TEXT,
    "fundedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Initiative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InitiativeReaction" (
    "id" TEXT NOT NULL,
    "initiativeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL DEFAULT 'UPVOTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InitiativeReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endorsement" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" "EndorsementKind" NOT NULL,
    "score" INTEGER,
    "reason" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Endorsement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyCheckin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "whatWorked" TEXT,
    "whatBlocked" TEXT,
    "nextFocus" TEXT,
    "managerReply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "trackKind" "TrackKind" NOT NULL,
    "actual" DOUBLE PRECISION NOT NULL,
    "scorePct" DOUBLE PRECISION NOT NULL,
    "weighted" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "tier" "TierKind" NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TierAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "courseTitle" TEXT NOT NULL,
    "folderParent" TEXT,
    "scheduledById" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "attendeeIds" JSONB NOT NULL,
    "graphEventId" TEXT,
    "onlineMeetingId" TEXT,
    "joinUrl" TEXT,
    "targetFolderId" TEXT,
    "recordingItemId" TEXT,
    "recordedVideoId" TEXT,
    "status" "LiveSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveAttendance" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secondsAttended" INTEGER NOT NULL DEFAULT 0,
    "attendedPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateIssue" (
    "id" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "formatTitle" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateFieldOption" (
    "id" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sop" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "workCategory" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopVersion" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "versionString" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "rawProcedure" TEXT NOT NULL,
    "brief" JSONB,
    "content" JSONB NOT NULL,
    "graphItemId" TEXT,
    "graphWebUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "creatorDesignation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopEditor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopEditor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopView" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SopView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeToolRun" (
    "id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "toolTitle" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeToolRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeoTuriaSession" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cookie" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeoTuriaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeoDirectorMapping" (
    "userId" TEXT NOT NULL,
    "turiaUserId" TEXT,
    "turiaUsername" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeoDirectorMapping_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "NeoInternalBudget" (
    "id" TEXT NOT NULL,
    "turiaTaskId" TEXT,
    "taskIdentity" TEXT,
    "taskName" TEXT NOT NULL,
    "approvedHours" DOUBLE PRECISION NOT NULL,
    "approvedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeoInternalBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeoProfitSplit" (
    "id" TEXT NOT NULL,
    "turiaTaskId" TEXT,
    "taskIdentity" TEXT,
    "taskName" TEXT NOT NULL,
    "splits" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeoProfitSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeoHoursSplit" (
    "id" TEXT NOT NULL,
    "turiaTaskId" TEXT,
    "taskIdentity" TEXT,
    "taskName" TEXT NOT NULL,
    "hours" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeoHoursSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeoIncentiveSnapshot" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "NeoIncentiveSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "pan" TEXT,
    "gstin" TEXT,
    "cin" TEXT,
    "industry" TEXT,
    "city" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "referralSource" TEXT,
    "turnover" DOUBLE PRECISION NOT NULL,
    "turnoverBand" "TurnoverBand" NOT NULL,
    "growthGoal" "GrowthGoal" NOT NULL,
    "growthNote" TEXT,
    "onboardedOn" TIMESTAMP(3) NOT NULL,
    "primaryHandlerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "graphFolderId" TEXT,
    "folderStatus" "FolderStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "handlerId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "dueOn" TIMESTAMP(3),
    "fees" DOUBLE PRECISION,
    "notes" TEXT,
    "graphFolderId" TEXT,
    "folderStatus" "FolderStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "jobId" TEXT,
    "docType" "ClientDocType" NOT NULL,
    "name" TEXT NOT NULL,
    "graphDriveId" TEXT NOT NULL,
    "graphItemId" TEXT NOT NULL,
    "webUrl" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Work" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT,
    "ownerId" TEXT NOT NULL,
    "status" "WorkStatus" NOT NULL DEFAULT 'INBOX',
    "obsoleteReason" TEXT,
    "lastTouchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTask" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "status" "WorkTaskStatus" NOT NULL DEFAULT 'TODO',
    "order" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekPlanWork" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "workId" TEXT NOT NULL,

    CONSTRAINT "WeekPlanWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayPick" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,
    "outcome" "DayPickOutcome",

    CONSTRAINT "DayPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeekReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkEvent" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT,
    "kind" "WorkEventKind" NOT NULL,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "DailyActivity_userId_idx" ON "DailyActivity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyActivity_userId_day_key" ON "DailyActivity"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Material_videoId_idx" ON "Material"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProgress_userId_videoId_key" ON "VideoProgress"("userId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_videoId_key" ON "Quiz"("videoId");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_submittedAt_idx" ON "QuizAttempt"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "Assignment_userId_status_idx" ON "Assignment"("userId", "status");

-- CreateIndex
CREATE INDEX "Assignment_videoId_idx" ON "Assignment"("videoId");

-- CreateIndex
CREATE INDEX "Assignment_moduleId_idx" ON "Assignment"("moduleId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_periodMonth_idx" ON "AttendanceRecord"("periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_periodMonth_key" ON "AttendanceRecord"("userId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "TrackTarget_cycleId_trackKind_level_key" ON "TrackTarget"("cycleId", "trackKind", "level");

-- CreateIndex
CREATE INDEX "Quest_userId_cycleId_idx" ON "Quest"("userId", "cycleId");

-- CreateIndex
CREATE INDEX "Quest_status_idx" ON "Quest"("status");

-- CreateIndex
CREATE INDEX "Initiative_cycleId_status_idx" ON "Initiative"("cycleId", "status");

-- CreateIndex
CREATE INDEX "InitiativeReaction_initiativeId_idx" ON "InitiativeReaction"("initiativeId");

-- CreateIndex
CREATE UNIQUE INDEX "InitiativeReaction_initiativeId_userId_kind_key" ON "InitiativeReaction"("initiativeId", "userId", "kind");

-- CreateIndex
CREATE INDEX "Endorsement_toId_idx" ON "Endorsement"("toId");

-- CreateIndex
CREATE INDEX "Endorsement_kind_idx" ON "Endorsement"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyCheckin_userId_weekStart_key" ON "WeeklyCheckin"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "TrackSnapshot_userId_cycleId_quarter_trackKind_key" ON "TrackSnapshot"("userId", "cycleId", "quarter", "trackKind");

-- CreateIndex
CREATE UNIQUE INDEX "TierAssignment_userId_cycleId_quarter_key" ON "TierAssignment"("userId", "cycleId", "quarter");

-- CreateIndex
CREATE INDEX "LiveSession_startAt_idx" ON "LiveSession"("startAt");

-- CreateIndex
CREATE INDEX "LiveSession_status_idx" ON "LiveSession"("status");

-- CreateIndex
CREATE INDEX "LiveAttendance_userId_idx" ON "LiveAttendance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveAttendance_liveSessionId_userId_key" ON "LiveAttendance"("liveSessionId", "userId");

-- CreateIndex
CREATE INDEX "CertificateIssue_createdById_idx" ON "CertificateIssue"("createdById");

-- CreateIndex
CREATE INDEX "CertificateIssue_formatId_idx" ON "CertificateIssue"("formatId");

-- CreateIndex
CREATE INDEX "CertificateIssue_createdAt_idx" ON "CertificateIssue"("createdAt");

-- CreateIndex
CREATE INDEX "CertificateFieldOption_fieldKey_idx" ON "CertificateFieldOption"("fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateFieldOption_fieldKey_value_key" ON "CertificateFieldOption"("fieldKey", "value");

-- CreateIndex
CREATE INDEX "Sop_department_idx" ON "Sop"("department");

-- CreateIndex
CREATE INDEX "Sop_createdAt_idx" ON "Sop"("createdAt");

-- CreateIndex
CREATE INDEX "SopVersion_sopId_idx" ON "SopVersion"("sopId");

-- CreateIndex
CREATE UNIQUE INDEX "SopEditor_userId_key" ON "SopEditor"("userId");

-- CreateIndex
CREATE INDEX "SopView_sopId_idx" ON "SopView"("sopId");

-- CreateIndex
CREATE INDEX "SopView_viewedAt_idx" ON "SopView"("viewedAt");

-- CreateIndex
CREATE INDEX "OfficeToolRun_createdById_idx" ON "OfficeToolRun"("createdById");

-- CreateIndex
CREATE INDEX "OfficeToolRun_tool_idx" ON "OfficeToolRun"("tool");

-- CreateIndex
CREATE INDEX "OfficeToolRun_createdAt_idx" ON "OfficeToolRun"("createdAt");

-- CreateIndex
CREATE INDEX "NeoInternalBudget_turiaTaskId_idx" ON "NeoInternalBudget"("turiaTaskId");

-- CreateIndex
CREATE INDEX "NeoInternalBudget_taskIdentity_idx" ON "NeoInternalBudget"("taskIdentity");

-- CreateIndex
CREATE INDEX "NeoProfitSplit_turiaTaskId_idx" ON "NeoProfitSplit"("turiaTaskId");

-- CreateIndex
CREATE INDEX "NeoProfitSplit_taskIdentity_idx" ON "NeoProfitSplit"("taskIdentity");

-- CreateIndex
CREATE INDEX "NeoHoursSplit_turiaTaskId_idx" ON "NeoHoursSplit"("turiaTaskId");

-- CreateIndex
CREATE INDEX "NeoHoursSplit_taskIdentity_idx" ON "NeoHoursSplit"("taskIdentity");

-- CreateIndex
CREATE INDEX "NeoIncentiveSnapshot_periodStart_idx" ON "NeoIncentiveSnapshot"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_folderName_key" ON "Client"("folderName");

-- CreateIndex
CREATE UNIQUE INDEX "Client_pan_key" ON "Client"("pan");

-- CreateIndex
CREATE INDEX "Client_primaryHandlerId_idx" ON "Client"("primaryHandlerId");

-- CreateIndex
CREATE INDEX "Client_turnoverBand_idx" ON "Client"("turnoverBand");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_department_name_key" ON "ServiceType"("department", "name");

-- CreateIndex
CREATE INDEX "Job_handlerId_idx" ON "Job"("handlerId");

-- CreateIndex
CREATE INDEX "Job_fy_idx" ON "Job"("fy");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Job_clientId_serviceTypeId_fy_key" ON "Job"("clientId", "serviceTypeId", "fy");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_idx" ON "ClientDocument"("clientId");

-- CreateIndex
CREATE INDEX "ClientDocument_jobId_idx" ON "ClientDocument"("jobId");

-- CreateIndex
CREATE INDEX "Work_ownerId_status_idx" ON "Work"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Work_status_lastTouchedAt_idx" ON "Work"("status", "lastTouchedAt");

-- CreateIndex
CREATE INDEX "WorkTask_workId_status_idx" ON "WorkTask"("workId", "status");

-- CreateIndex
CREATE INDEX "WorkTask_assigneeId_status_idx" ON "WorkTask"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WeekPlanWork_userId_weekStart_workId_key" ON "WeekPlanWork"("userId", "weekStart", "workId");

-- CreateIndex
CREATE INDEX "DayPick_userId_day_idx" ON "DayPick"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DayPick_userId_day_taskId_key" ON "DayPick"("userId", "day", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekReview_userId_weekStart_key" ON "WeekReview"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "WorkEvent_workId_at_idx" ON "WorkEvent"("workId", "at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProgress" ADD CONSTRAINT "VideoProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProgress" ADD CONSTRAINT "VideoProgress_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackTarget" ADD CONSTRAINT "TrackTarget_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestMilestone" ADD CONSTRAINT "QuestMilestone_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InitiativeReaction" ADD CONSTRAINT "InitiativeReaction_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InitiativeReaction" ADD CONSTRAINT "InitiativeReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyCheckin" ADD CONSTRAINT "WeeklyCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyCheckin" ADD CONSTRAINT "WeeklyCheckin_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackSnapshot" ADD CONSTRAINT "TrackSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackSnapshot" ADD CONSTRAINT "TrackSnapshot_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierAssignment" ADD CONSTRAINT "TierAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierAssignment" ADD CONSTRAINT "TierAssignment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveAttendance" ADD CONSTRAINT "LiveAttendance_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveAttendance" ADD CONSTRAINT "LiveAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateIssue" ADD CONSTRAINT "CertificateIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopVersion" ADD CONSTRAINT "SopVersion_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopView" ADD CONSTRAINT "SopView_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "Sop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeToolRun" ADD CONSTRAINT "OfficeToolRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_primaryHandlerId_fkey" FOREIGN KEY ("primaryHandlerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_handlerId_fkey" FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Work" ADD CONSTRAINT "Work_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Work" ADD CONSTRAINT "Work_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekPlanWork" ADD CONSTRAINT "WeekPlanWork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekPlanWork" ADD CONSTRAINT "WeekPlanWork_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPick" ADD CONSTRAINT "DayPick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPick" ADD CONSTRAINT "DayPick_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekReview" ADD CONSTRAINT "WeekReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkEvent" ADD CONSTRAINT "WorkEvent_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkEvent" ADD CONSTRAINT "WorkEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

