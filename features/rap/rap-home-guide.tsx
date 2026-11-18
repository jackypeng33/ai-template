import type { ReactNode } from "react";
import Image from "next/image";
import { Plus } from "lucide-react";
import { RAP_PRODUCT } from "@/lib/rap/config";
import s from "./rap.module.css";

const amount = (RAP_PRODUCT.priceCents / 100).toFixed(2);
const price = `$${amount} USD`;
const videoSpec = `${RAP_PRODUCT.duration}-second, ${RAP_PRODUCT.aspectRatio}, ${RAP_PRODUCT.resolution} MP4`;

export const homeSections = [
  ["how-it-works", "How it works", "How to make a rap video in 3 steps"],
  ["free-preview", "Free preview", "Free AI rap video generator"],
  ["the-track", "The track", "One built-in rap track"],
  ["lyrics-or-mp3", "Lyrics or MP3", "Lyrics to rap video, or MP3 to rap video"],
  ["vertical-video", "Vertical video", "Vertical rap videos for TikTok, Shorts and Reels"],
  ["maker-vs-generator", "Compare tools", "Rap video maker vs AI rap generator: which do you need?"],
  ["faq", "FAQ", "FAQ"],
] as const;

export function RapHomeGuide({ checkoutAvailable, trackPlayer }: { checkoutAvailable: boolean; trackPlayer: ReactNode }) {
  const faq = [
    ["Is this rap video generator really free?", `The photo preview and reference track are free. The price for a finished video is ${price}, paid once. ${checkoutAvailable ? "Sign in to buy one." : "Checkout and generation are paused."}`],
    ["Do I need to install an app?", "No. Open this page in your browser and try the sample photos or choose your own. You do not need an account for the preview."],
    ["Can I use my own lyrics?", "No. The template uses a fixed English rap track. There is no text box, lyrics editor or MP3 upload."],
    ["What styles are available?", "There is one studio template with one built-in track. There is no style picker for trap, drill, boom bap or old school."],
    ["Can I download in 9:16 for TikTok?", `The video format is a ${videoSpec}. ${checkoutAvailable ? "You can download it from My videos after it passes the content check." : "The free preview does not produce a video you can download."}`],
    ["Do I own the video I make?", "You must have permission to use both people's photos and likenesses. Ownership of the finished video and rights to publish or use the soundtrack commercially have not been confirmed."],
    ["Which languages does it support?", "The page and the built-in rap track are in English. There is no setting to change the lyrics or the language of the vocals."],
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "RapVideoMaker",
        applicationCategory: "MultimediaApplication",
        offers: {
          "@type": "Offer",
          name: "One duo rap video",
          price: amount,
          priceCurrency: RAP_PRODUCT.currency.toUpperCase(),
          availability: checkoutAvailable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };

  return <div className={s.homeGuide}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    {homeSections.map(([id, , title], index) => <section key={id} id={id} className={s.homeChapter} aria-labelledby={`${id}-heading`}>
      <header>
        <span className={s.kicker} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <h2 id={`${id}-heading`}>{title}</h2>
      </header>
      {id === "how-it-works" && <div>
        <ol className={s.homeSteps}>
          <li><strong>Pick two photos.</strong> Put yourself on the left and your friend on the right, or use the sample pair to see how the two slots work.</li>
          <li><strong>Play the built-in track.</strong> Hear the beat and English vocals that go with the template, with the left person cast as the lead and the right person nodding along.</li>
          <li><strong>{checkoutAvailable ? "Sign in, pay once, then download." : "Check the video format."}</strong> {checkoutAvailable ? `After the video passes its content check, download the ${videoSpec} from My videos within ${RAP_PRODUCT.videoDays} days.` : `When checkout opens, you’ll sign in and pay once for a ${videoSpec}, with a ${RAP_PRODUCT.videoDays}-day download window.`}</li>
        </ol>
        <p>Use one adult per photo and get both people’s permission. Pick clear, front-facing shots so you can tell at a glance who is on each side. Use JPG, PNG or WebP photos, at least 300 × 300 pixels and up to 10 MB each. Keep the same tab open while you test the layout so you can swap a photo and compare both slots.</p>
      </div>}
      {id === "free-preview" && <div>
        <p>Here for a free ai rap video generator? You can try the two sample photos, swap in your own pair and listen to the built-in reference track for free. You do not need an account, a payment method or an app. The preview shows the photo slots and lets you hear the track separately.</p>
        <p>The preview does not create a video file. There are no free video generations, so there is no free export length, watermark or generation quota to compare. The watermark policy for finished videos has not been confirmed.</p>
        <p id="pricing"><strong>Video pricing:</strong> {price} for one {videoSpec}. No subscription or credit pack is required. {checkoutAvailable ? "Sign in to continue to checkout." : "Checkout is paused, so you cannot buy or generate the clip today."}</p>
        <p>You can replace either photo or remove both without paying. Try the samples first if you want to see which slot is the lead before adding your own photos.</p>
        <p><a href="#create">Go to the photo picker</a> <span aria-hidden="true">·</span> <a href="#the-track">Hear the reference track</a></p>
      </div>}
      {id === "the-track" && <div className={s.homeTrack}>
        <div>
          <p>The template puts two people at one mic and uses a fixed beat and English vocals. Use the player to hear the reference track.</p>
          <blockquote>“{RAP_PRODUCT.lyrics}”</blockquote>
          {trackPlayer}
        </div>
        <figure className={s.homeConcept}>
          <Image src="/rap/booth-concept-v1.webp" alt="Concept art of two people sharing a microphone in an orange recording studio" fill loading="lazy" sizes="(max-width: 600px) 140px, 160px" />
          <figcaption>CONCEPT ART · NOT A GENERATED VIDEO</figcaption>
        </figure>
      </div>}
      {id === "lyrics-or-mp3" && <div>
        <p>If you’re starting with an idea or a rough verse, a text to rap video tool needs to turn your words into a performance. A lyrics to rap video tool starts with lines you’ve already written. If you’ve recorded your own vocals and beat, an MP3 to rap video workflow starts with that finished track.</p>
        <p>RapVideoMaker takes two photos and supplies the English track. You can choose who goes on each side and listen to the reference. You can’t paste words, replace the track or upload an MP3 here.</p>
      </div>}
      {id === "vertical-video" && <div>
        <p>The template is set up for one {videoSpec}. That’s a portrait clip for watching on a phone. The free preview does not produce a downloadable file, so there’s no export to post while generation is paused.</p>
        <ul className={s.homePlatformTips}>
          <li><strong>TikTok:</strong> Preview the post in the app. Check that faces stay clear of the caption and controls along the edges.</li>
          <li><strong>YouTube Shorts:</strong> Play the whole clip before posting. Check that it starts where you want and that the last second doesn’t cut off a line you expected to hear.</li>
          <li><strong>Instagram Reels:</strong> Check the cover crop before publishing. Make sure both people are visible in the cropped cover as well as in the full vertical video.</li>
        </ul>
        <p>Before sharing on any platform, check that both people are comfortable with the post and that you have permission to publish the audio. The preview track alone does not establish those rights.</p>
      </div>}
      {id === "maker-vs-generator" && <div>
        <p>Start with the file you need. If you already have the song and need something to watch, look for a tool with video output and support for your audio. If you still need the song, look for a tool that makes an audio track you can use in an edit.</p>
        <table className={s.homeComparison}>
          <caption>What each tool is for</caption>
          <thead><tr><th scope="col">Tool</th><th scope="col">What to check</th></tr></thead>
          <tbody>
            <tr><th scope="row">rap video maker</th><td>Look for a video file, its aspect ratio and whether the tool accepts your photos or audio.</td></tr>
            <tr><th scope="row">AI rap generator</th><td>Look for a downloadable audio track and check who supplies the lyrics, vocals and beat.</td></tr>
          </tbody>
        </table>
        <p>The free ai rap video preview lets you try the two-photo layout and hear the preset track. If you want to perform your own verse, check for a custom lyrics or audio input before settling on a tool.</p>
      </div>}
      {id === "faq" && <div className={s.faqList}>
        {faq.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={17} aria-hidden="true" /></summary><p>{answer}</p></details>)}
      </div>}
    </section>)}
  </div>;
}
