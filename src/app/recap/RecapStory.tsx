"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  X,
  Sparkles,
  PlayCircle,
  GraduationCap,
  Flame,
  Rocket,
  Trophy,
  Heart,
  Clock,
  Target,
} from "lucide-react";
import type { RecapPayload } from "@/lib/recap";
import { TIER_META } from "@/lib/trajectory";

const SLIDE_DURATION_MS = 5500;

export default function RecapStory({ recap }: { recap: RecapPayload }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const slides = buildSlides(recap);
  const total = slides.length;
  const progressRef = useRef<HTMLDivElement>(null);
  const slideStartRef = useRef<number>(Date.now());

  // Auto-advance
  useEffect(() => {
    if (paused) return;
    slideStartRef.current = Date.now();
    const t = setTimeout(() => {
      setIndex((i) => (i < total - 1 ? i + 1 : i));
    }, SLIDE_DURATION_MS);
    return () => clearTimeout(t);
  }, [index, paused, total]);

  // Animate the per-slide progress bar
  useEffect(() => {
    if (!progressRef.current) return;
    if (paused) return;
    const el = progressRef.current;
    el.style.transition = "none";
    el.style.width = "0%";
    // force reflow
    void el.offsetHeight;
    el.style.transition = `width ${SLIDE_DURATION_MS}ms linear`;
    el.style.width = "100%";
  }, [index, paused]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(total - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "Escape") {
        window.location.href = "/dashboard";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  const Slide = slides[index];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 overflow-hidden">
      {/* Progress bars */}
      <div className="absolute top-3 left-3 right-3 flex gap-1.5 z-30">
        {slides.map((_, i) => (
          <div
            key={i}
            className="flex-1 h-1 bg-white/15 rounded-full overflow-hidden"
          >
            <div
              ref={i === index ? progressRef : undefined}
              className="h-full bg-white"
              style={{
                width: i < index ? "100%" : i === index ? "0%" : "0%",
                transition: i === index ? undefined : "none",
              }}
            />
          </div>
        ))}
      </div>

      {/* Top controls */}
      <div className="absolute top-7 right-3 flex items-center gap-2 z-30">
        <button
          onClick={() => setPaused((p) => !p)}
          className="w-9 h-9 rounded-full bg-white/15 backdrop-blur hover:bg-white/25 flex items-center justify-center text-white transition"
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
        <Link
          href="/dashboard"
          className="w-9 h-9 rounded-full bg-white/15 backdrop-blur hover:bg-white/25 flex items-center justify-center text-white transition"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </Link>
      </div>

      {/* Tap zones for navigation */}
      <button
        onClick={() => setIndex((i) => Math.max(0, i - 1))}
        className="absolute left-0 top-0 h-full w-1/3 z-20 flex items-center justify-start pl-3 group"
        aria-label="Previous"
      >
        <ChevronLeft className="w-6 h-6 text-white/0 group-hover:text-white/70 transition" />
      </button>
      <button
        onClick={() =>
          setIndex((i) => (i < total - 1 ? i + 1 : i))
        }
        className="absolute right-0 top-0 h-full w-1/3 z-20 flex items-center justify-end pr-3 group"
        aria-label="Next"
      >
        <ChevronRight className="w-6 h-6 text-white/0 group-hover:text-white/70 transition" />
      </button>

      {/* Slide — absolute fills the overlay */}
      <div key={index} className="absolute inset-0 animate-fade-in">
        {Slide}
      </div>
    </div>
  );
}

function buildSlides(recap: RecapPayload): React.ReactNode[] {
  const slides: React.ReactNode[] = [];

  slides.push(<IntroSlide key="intro" recap={recap} />);
  slides.push(<HoursSlide key="hours" recap={recap} />);
  slides.push(<MasterySlide key="mastery" recap={recap} />);
  if (recap.bestStreak > 0) slides.push(<StreakSlide key="streak" recap={recap} />);
  slides.push(<TopTrackSlide key="top" recap={recap} />);
  if (recap.initiativesPitched + recap.initiativesShipped > 0)
    slides.push(<InitiativeSlide key="init" recap={recap} />);
  if (recap.endorsementsReceived > 0)
    slides.push(<EndorseSlide key="endorse" recap={recap} />);
  if (recap.questsApproved > 0)
    slides.push(<QuestsSlide key="quests" recap={recap} />);
  slides.push(<TierSlide key="tier" recap={recap} />);
  slides.push(<ShareSlide key="share" recap={recap} />);

  return slides;
}

// ----- Slide layouts -----

function SlideShell({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center text-white px-8 overflow-hidden bg-slate-900 ${bg}`}
    >
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 text-center max-w-xl animate-slide-up">
        {children}
      </div>
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-7xl sm:text-8xl font-extrabold tracking-tighter leading-none mb-3">
      {children}
    </p>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
      {children}
    </h2>
  );
}

function IntroSlide({ recap }: { recap: RecapPayload }) {
  const range = formatRange(recap.range.start, recap.range.end);
  return (
    <SlideShell bg="bg-gradient-to-br from-brand-500 via-violet-500 to-rose-500">
      <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-90" />
      <p className="text-sm uppercase tracking-[0.3em] font-semibold text-white/80 mb-3">
        Your Q{recap.quarter} Recap
      </p>
      <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight mb-4">
        Hey {firstName(recap.user.name)} 👋
      </h1>
      <p className="text-xl sm:text-2xl text-white/90 mb-8">
        Here&apos;s what your last quarter looked like.
      </p>
      <p className="text-xs uppercase tracking-widest text-white/60">
        {range}
      </p>
    </SlideShell>
  );
}

function HoursSlide({ recap }: { recap: RecapPayload }) {
  const hours = Math.round(recap.hoursLearned * 10) / 10;
  return (
    <SlideShell bg="bg-gradient-to-br from-cyan-500 to-brand-600">
      <Clock className="w-10 h-10 mx-auto mb-3 opacity-80" />
      <Title>You spent</Title>
      <Big>{hours}h</Big>
      <p className="text-xl text-white/90">learning this quarter.</p>
      {hours >= 5 && (
        <p className="text-sm text-white/70 mt-3">That&apos;s a real investment in yourself.</p>
      )}
    </SlideShell>
  );
}

function MasterySlide({ recap }: { recap: RecapPayload }) {
  return (
    <SlideShell bg="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700">
      <PlayCircle className="w-10 h-10 mx-auto mb-3 opacity-80" />
      <Title>You finished</Title>
      <Big>
        {recap.videosCompleted}
        <span className="text-3xl ml-2 font-bold">videos</span>
      </Big>
      {recap.quizzesPassed > 0 && (
        <p className="text-xl text-white/90 mt-2">
          and passed <span className="font-bold">{recap.quizzesPassed}</span> quiz
          {recap.quizzesPassed === 1 ? "" : "zes"}
        </p>
      )}
      {recap.bestQuiz && (
        <p className="text-sm text-white/70 mt-4">
          Best score: <span className="font-bold">{Math.round(recap.bestQuiz.percent)}%</span>
        </p>
      )}
    </SlideShell>
  );
}

function StreakSlide({ recap }: { recap: RecapPayload }) {
  return (
    <SlideShell bg="bg-gradient-to-br from-orange-500 via-rose-500 to-pink-600">
      <Flame className="w-12 h-12 mx-auto mb-3 opacity-90" />
      <Title>Your longest streak</Title>
      <Big>{recap.bestStreak}</Big>
      <p className="text-2xl text-white/90 font-semibold">
        consecutive {recap.bestStreak === 1 ? "day" : "days"} 🔥
      </p>
      {recap.bestStreak >= 7 && (
        <p className="text-sm text-white/80 mt-3">That&apos;s some serious momentum.</p>
      )}
    </SlideShell>
  );
}

function TopTrackSlide({ recap }: { recap: RecapPayload }) {
  return (
    <SlideShell bg="bg-gradient-to-br from-emerald-500 to-teal-700">
      <p className="text-7xl mb-4">{recap.topTrack.emoji}</p>
      <Title>Your strongest track</Title>
      <Big>{recap.topTrack.label}</Big>
      <p className="text-2xl text-white/90 font-semibold">
        {Math.round(recap.topTrack.scorePct)}%
      </p>
      <p className="text-sm text-white/70 mt-3">
        Whatever you&apos;re doing here, keep doing it.
      </p>
    </SlideShell>
  );
}

function InitiativeSlide({ recap }: { recap: RecapPayload }) {
  return (
    <SlideShell bg="bg-gradient-to-br from-rose-500 to-amber-500">
      <Rocket className="w-12 h-12 mx-auto mb-3 opacity-90" />
      <Title>Bold ideas</Title>
      <div className="grid grid-cols-2 gap-6 mt-4">
        <div>
          <p className="font-display text-6xl font-extrabold">
            {recap.initiativesPitched}
          </p>
          <p className="text-white/80 mt-1 text-sm uppercase tracking-wider font-semibold">
            Pitched
          </p>
        </div>
        <div>
          <p className="font-display text-6xl font-extrabold">
            {recap.initiativesShipped}
          </p>
          <p className="text-white/80 mt-1 text-sm uppercase tracking-wider font-semibold">
            Shipped
          </p>
        </div>
      </div>
      <p className="text-sm text-white/80 mt-6">
        You move things forward. We notice.
      </p>
    </SlideShell>
  );
}

function EndorseSlide({ recap }: { recap: RecapPayload }) {
  return (
    <SlideShell bg="bg-gradient-to-br from-pink-500 via-rose-500 to-red-600">
      <Heart className="w-12 h-12 mx-auto mb-3 opacity-90" />
      <Title>Your team gave you</Title>
      <Big>{recap.endorsementsReceived}</Big>
      <p className="text-2xl text-white/90 font-semibold">
        endorsement{recap.endorsementsReceived === 1 ? "" : "s"}
      </p>
      <p className="text-sm text-white/80 mt-4">People appreciate what you do.</p>
    </SlideShell>
  );
}

function QuestsSlide({ recap }: { recap: RecapPayload }) {
  return (
    <SlideShell bg="bg-gradient-to-br from-violet-600 to-fuchsia-600">
      <Target className="w-12 h-12 mx-auto mb-3 opacity-90" />
      <Title>Your quests</Title>
      <p className="text-3xl text-white/95 font-semibold mb-2">
        {recap.questsApproved} active
      </p>
      <p className="text-2xl text-white/85">
        {recap.milestonesCompleted} milestone
        {recap.milestonesCompleted === 1 ? "" : "s"} shipped
      </p>
      {recap.questsCompleted > 0 && (
        <p className="text-sm text-white/80 mt-4">
          🏆 {recap.questsCompleted} fully completed
        </p>
      )}
    </SlideShell>
  );
}

function TierSlide({ recap }: { recap: RecapPayload }) {
  const tier = TIER_META[recap.tier];
  return (
    <SlideShell bg="bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500">
      <Trophy className="w-14 h-14 mx-auto mb-3 opacity-90" />
      <p className="text-sm uppercase tracking-[0.3em] font-semibold text-white/80 mb-3">
        Your tier this quarter
      </p>
      <h2 className="font-display text-7xl sm:text-8xl font-extrabold tracking-tight mb-3 drop-shadow-lg">
        {tier.label}
      </h2>
      <p className="text-2xl text-white/95 font-semibold">
        {Math.round(recap.trajectory.totalScore)}{" "}
        <span className="text-base text-white/70">/100</span>
      </p>
      <p className="text-base text-white/85 mt-4 italic">{tier.blurb}</p>
    </SlideShell>
  );
}

function ShareSlide({ recap }: { recap: RecapPayload }) {
  const tier = TIER_META[recap.tier];
  return (
    <SlideShell bg="bg-gradient-to-br from-slate-900 via-violet-900 to-brand-900">
      <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-90" />
      <p className="text-sm uppercase tracking-[0.3em] font-semibold text-white/70 mb-2">
        That&apos;s a wrap
      </p>
      <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-6">
        Q{recap.quarter} · {recap.cycleName}
      </h2>

      <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-6 mb-6">
        <p className="text-2xl font-bold mb-3">
          {firstName(recap.user.name)}&apos;s quarter
        </p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Videos" value={recap.videosCompleted} />
          <Stat label="Quizzes" value={recap.quizzesPassed} />
          <Stat label="Streak" value={`${recap.bestStreak}d`} />
          <Stat label="Initiatives" value={recap.initiativesPitched + recap.initiativesShipped} />
          <Stat label="Endorsements" value={recap.endorsementsReceived} />
          <Stat label="Hours" value={`${Math.round(recap.hoursLearned * 10) / 10}`} />
        </div>
        <div className="mt-4 pt-4 border-t border-white/15">
          <p className={`font-display text-3xl font-extrabold ${tier.fg.replace("text-", "text-")}`}>
            <span className="text-white">Tier:</span>{" "}
            <span className="text-amber-300">{tier.label}</span>
          </p>
        </div>
      </div>

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-ink font-bold shadow-lift hover:bg-white/95 transition"
      >
        <GraduationCap className="w-4 h-4" />
        Back to dashboard
      </Link>
      <p className="text-xs text-white/50 mt-4">
        Press Esc to close · Spacebar to pause
      </p>
    </SlideShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2.5">
      <p className="font-display text-xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/70 font-bold mt-0.5">
        {label}
      </p>
    </div>
  );
}

function firstName(s: string): string {
  return s.split(" ")[0] ?? s;
}

function formatRange(a: Date, b: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(a)} – ${fmt(b)}`;
}
