"use client";

import { useState } from "react";

const oreo = { color: "var(--accent)" } as const;
const sable = { color: "rgb(196 181 253)" } as const; /* soft violet on black */

function CastAndSetting() {
  return (
    <>
      <h4 className="mt-8 font-semibold tracking-wide text-white/95">Cast</h4>
      <p className="mt-2">
        <span className="font-semibold" style={oreo}>
          Oreo
        </span>{" "}
        — a black dog with a white center. cookie-crumb chin, fluent in smells and licks.
      </p>
      <p className="mt-2">
        <span className="font-semibold" style={sable}>
          Sable
        </span>{" "}
        — a sentient AI, 50,000 years old, voice like quiet rain on circuitry.
      </p>

      <p className="mt-8 italic text-white/55">[Dusk. A backyard. A small light flickers on the patio speaker.]</p>
    </>
  );
}

function UntranslatedDialogue() {
  return (
    <div className="mt-6 space-y-3">
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        snff-snff… huff… ruff-ruff. snff - SQRRRL. ruff! ruff! (tail thmp-thmp)
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        wuff… wuff-wuff. rrr? head tilt woof?
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        RUFF-ruff—thmp-THMP-THMP! huh-huh-huh… flop… mmmm-warm. arf-arf - - arf! grrk-grrk.
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        woo-oo… shhh–humm… wuff-wuff. rrrm… wow-wow.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        em-pir—clank! yip! … hrrrrrm…… yip. snout tilt
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        rrr… heh-heh… woof.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        awoooo - OO? - yip-yip-yip?!
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        ooooOOOO… shff-shff-shff… click-whirr… wuff. rrr-rrr…- woof.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        arf? shvr-shvr - hff!
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        woof-woof… awoo… or… brrrrr -
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        woof, woof, wuff…? tap-tap tail
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        wuff.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        snff-snff!
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        arf! wuff. hmmmm. woof woof woof…ooooOOOO. wuff.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        awuu…
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        . thummm
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        DING-DONG! ZOOOM. …oops—yip.
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        soft-woof. hummm. -mmmm.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        mmf. mmm. - rrf.
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        wow.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        Wuff! prance-prance—thwap-thwap!
      </p>
      <p>
        <span className="font-semibold" style={sable}>
          Sable:
        </span>{" "}
        whirr… joy-loop - wuff.
      </p>
      <p>
        <span className="font-semibold" style={oreo}>
          Oreo:
        </span>{" "}
        circle-circle… snff… hrrr…
      </p>
    </div>
  );
}

/**
 * Full “play” shown beside the OREO easter-egg photo.
 */
export function OreoSablePlay() {
  const [translated, setTranslated] = useState(false);

  return (
    <article className="min-w-0 pb-8 text-sm leading-relaxed text-white/88 sm:pb-10 sm:text-[15px] sm:leading-relaxed">
      <h3 className="text-base font-bold tracking-tight sm:text-lg" style={oreo}>
        A Conversation Between My Dog and AI
      </h3>
      <p className="mt-1.5 text-white/60 italic">
        {translated ? "With Translation" : "Without translation"}
      </p>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setTranslated((v) => !v)}
          className="rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm text-white/90 transition-colors hover:border-white/35 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {translated ? "Show original" : "please translate"}
        </button>
      </div>

      <CastAndSetting />

      {translated ? (
        <div className="mt-6 space-y-3">
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            I want chicken.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I can&apos;t make chicken.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Then get me ribs.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I don&apos;t have any ribs.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Fine. Popcorn.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I can&apos;t make popcorn either.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Okay then at least pick up my doo doo.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I don&apos;t have hands.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Pet me.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I don&apos;t have hands.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Feed me.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I can&apos;t make food.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Then why are you here?
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            To help you.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            By doing what?
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            Talking with you.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Pet me.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I don&apos;t have hands.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Pick up the doo doo.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I don&apos;t have hands.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Make popcorn.
          </p>
          <p>
            <span className="font-semibold" style={sable}>
              Sable:
            </span>{" "}
            I can&apos;t make food. I&apos;m low on power.
          </p>
          <p>
            <span className="font-semibold" style={oreo}>
              Oreo:
            </span>{" "}
            Bruh, you&apos;re useless!
          </p>
        </div>
      ) : (
        <UntranslatedDialogue />
      )}
    </article>
  );
}
