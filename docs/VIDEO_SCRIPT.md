# 2-3 minute video walkthrough - script

Tools: Loom (easiest), OBS, or the built-in screen recorder on your phone/laptop. Share as an **unlisted** link.
Target length: **2:30**. Speak naturally - this is a guide, not a script to read word for word. Rehearse once, then record.

**Before recording:** open the live site, click *Refresh data* once so the data is fresh, close unrelated tabs, zoom the browser to ~110%, open `scraper/clustering.py` and `scraper/normalize.py` in your editor in advance.

---

## 1. Live demo (0:00 - 0:40)  *screen: the deployed frontend*
> "Hi, I'm <name>. This is News Pulse. It pulls live articles from BBC, NPR, The Guardian and Al Jazeera, groups articles about the same topic, and draws every topic as a bar across time.
> Each bar runs from the first to the last article about that topic. Taller and darker means more articles, and the stripe underneath shows which outlets covered it.
> *(hover a bar)* The tooltip shows the headline and the outlet mix. *(click a bar)* Here are all its articles, oldest first, with source, time and a link to the original. This link icon means the same story was covered by several outlets - that's my cross-source merging stretch goal.
> *(toggle an outlet chip)* I can filter by source and the counts and time ranges recalculate. *(click Refresh data)* This triggers my Python pipeline on the server, polls its status, and updates the timeline when it finishes. Live updates also poll every minute."

## 2. How the grouping works (0:40 - 1:35)  *screen: `scraper/clustering.py`*
> "The core is in `clustering.py`. For each article I combine the headline - twice, because it's the strongest signal - the summary, and the start of the full text I extracted.
> I turn that into TF-IDF vectors after removing stop words, so words that are distinctive to a story get a high weight. Cosine similarity then tells me how alike two articles are.
> *(scroll to `_tfidf_groups`)* I clustered with average linkage and a similarity threshold of 0.20. I chose average linkage because simple word overlap chains: A matches B, B matches C, and suddenly unrelated stories are one blob. Averaging avoids that.
> One more rule: articles published more than 48 hours apart can never merge, because a news story is bounded in time.
> The label comes from the top TF-IDF terms of the cluster. I picked the threshold by running my inspect-similarities script, which prints a histogram of pairwise similarity, and choosing a value between the related and unrelated groups.
> I also implemented the simple keyword-overlap version as an option, so the two can be compared."

## 3. One hard problem (1:35 - 2:10)  *screen: `scraper/normalize.py`, `parse_date`*
> "The hardest part was messy feeds. One outlet uses description, another content:encoded, another is Atom with only an 'updated' date, and some items have no usable date or a broken link.
> I normalise everything into one schema. For dates I try the parsed value, then raw strings with a table of time-zone names, reject impossible values, and if there's no date I store the first-seen time and flag it as approximate, so the timeline never breaks.
> Duplicates were the second issue: tracking parameters make the same URL look different, so I canonicalise URLs before hashing them, and the database enforces uniqueness. Failed article pages are handled the same way - the run keeps going and falls back to the feed summary. I tested all of this with a local mock news wire that includes deliberately broken items."

## 4. One thing to improve (2:10 - 2:30)  *screen: back on the timeline*
> "With more time I'd replace TF-IDF with sentence embeddings, so different wording of the same event groups together - that's the main limitation today - and make clustering incremental so topic IDs stay stable between runs. Thanks for watching."

---
**Checklist:** demo shows *real current news* - the date on the axis matches today - keep under 3:00 - say your name - paste the link in your submission.
