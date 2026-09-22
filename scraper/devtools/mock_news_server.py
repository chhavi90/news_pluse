"""A local fake news wire for offline development and automated tests.

It serves three RSS/Atom feeds in deliberately *different* formats, plus the article
pages they link to - including a broken page, a paywalled page, a duplicate item, an
item without a link and an item with an unparseable date.  Nothing here is real news.

    python -m scraper.devtools.mock_news_server        # serves on http://127.0.0.1:8765
    FEEDS_FILE=scraper/devtools/feeds.local.json python -m scraper.run
"""
from __future__ import annotations

import html
import threading
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

# (story key, [(outlet, hours_before_now, headline, summary)])
STORIES = {
    "rates": [
        ("alpha", 50, "Central bank holds interest rates steady as inflation cools",
         "The central bank left its benchmark interest rate unchanged on Thursday, citing cooling inflation."),
        ("beta", 49, "Interest rates unchanged: central bank cites cooling inflation",
         "Policymakers kept borrowing costs on hold and said inflation is easing toward the target."),
        ("gamma", 48, "Central bank keeps rates on hold, signals cuts later this year",
         "The bank held its interest rate and hinted at cuts if inflation keeps cooling."),
        ("alpha", 27, "Markets rally after central bank interest rate decision",
         "Stocks and bonds rose a day after the central bank held rates and signalled future cuts."),
    ],
    "quake": [
        ("alpha", 30, "Strong earthquake strikes northern coast, tsunami warning issued",
         "A strong earthquake struck off the northern coast and authorities issued a tsunami warning."),
        ("beta", 29, "Magnitude 7.1 earthquake hits coast; tsunami alert for coastal towns",
         "Coastal towns were told to move inland after a magnitude 7.1 earthquake hit offshore."),
        ("gamma", 20, "Rescue teams search rubble after coastal earthquake",
         "Rescue teams searched collapsed buildings a day after the earthquake and tsunami alert on the coast."),
    ],
    "fire": [
        ("beta", 22, "Evacuations ordered as forest wildfire spreads across mountain valleys",
         "Thousands of residents were told to evacuate as a wildfire spread through forest and mountain valleys."),
        ("alpha", 21, "Wildfire forces thousands to evacuate in western forest region",
         "A fast-moving wildfire in the western forest region forced thousands of people to evacuate."),
        ("gamma", 14, "Firefighters battle wildfire as evacuation zones expand",
         "Firefighters struggled to contain the forest wildfire while evacuation zones grew wider."),
        ("beta", 6, "Wildfire smoke blankets cities as firefighters gain ground",
         "Smoke from the forest wildfire drifted over nearby cities while firefighters made progress."),
    ],
    "vote": [
        ("gamma", 40, "Opposition party wins regional election in surprise result",
         "The opposition party won the regional election, defeating the governing coalition in a surprise result."),
        ("alpha", 38, "Regional election upset: opposition defeats governing coalition",
         "Voters handed the opposition a surprise win in the regional election, defeating the governing coalition."),
        ("beta", 36, "Governing coalition concedes after regional election defeat",
         "The governing coalition conceded defeat after the opposition won the regional election."),
    ],
    "chip": [
        ("beta", 12, "Chipmaker unveils new AI processor to challenge rivals",
         "The chipmaker unveiled a new AI processor it says outperforms rival data centre chips."),
        ("gamma", 11, "New AI chip launch puts pressure on semiconductor rivals",
         "A new AI processor from the chipmaker raised pressure on rival semiconductor companies."),
    ],
    "cricket": [
        ("alpha", 8, "National team wins cricket championship final after dramatic last over",
         "The national cricket team won the championship final with a boundary in a dramatic last over."),
        ("gamma", 7, "Dramatic last over hands cricket championship to national team",
         "A dramatic last over decided the cricket championship final in favour of the national team."),
        ("beta", 5, "Cricket champions celebrate as national team returns home",
         "Fans greeted the cricket championship winners as the national team returned home."),
    ],
    "strike": [
        ("alpha", 18, "Rail workers strike disrupts commuter services across the country",
         "A strike by rail workers cancelled commuter services and disrupted travel across the country."),
        ("beta", 17, "Commuters stranded as rail strike halts trains nationwide",
         "Commuters were stranded as a nationwide rail workers strike halted trains."),
    ],
    "lunar": [
        ("gamma", 3, "Lunar probe launch delayed by weather at spaceport",
         "The launch of a lunar probe was postponed because of stormy weather at the spaceport."),
        ("alpha", 2, "Space agency postpones lunar probe launch over storm forecast",
         "The space agency postponed its lunar probe launch because of a storm forecast at the spaceport."),
    ],
    "misc": [
        ("alpha", 10, "Museum opens new dinosaur exhibition for families",
         "A city museum opened a dinosaur exhibition with life-size fossils and interactive displays."),
        ("beta", 15, "Study links irregular sleep patterns to weaker memory",
         "Researchers found that people with irregular sleep patterns scored lower on memory tests."),
        ("gamma", 9, "Local bakery wins national sourdough bread award",
         "A neighbourhood bakery took the top prize at the national sourdough bread awards."),
    ],
}

BODY = {
    "rates": ["The central bank said inflation has cooled for several months and that its benchmark interest rate would stay where it is.",
              "Economists had expected the decision, and the governor told reporters that further interest rate cuts depend on inflation data.",
              "Households with variable mortgages will see no change in monthly payments while the central bank waits for more evidence.",
              "Bond markets moved little at first, but stocks rose after the governor signalled that rate cuts could come later this year."],
    "quake": ["The earthquake struck just off the northern coast and was felt in several towns, where buildings shook and power was cut.",
              "Authorities issued a tsunami warning and told residents of coastal towns to move to higher ground while sirens sounded.",
              "Rescue teams later searched collapsed buildings for survivors as aftershocks continued along the coast.",
              "Emergency officials said the tsunami alert was lifted after sea levels returned to normal, but damaged roads slowed rescue efforts."],
    "fire": ["The wildfire spread quickly through dry forest and mountain valleys, driven by strong winds and record temperatures.",
             "Thousands of residents were ordered to evacuate as the fire advanced, and evacuation zones were widened overnight.",
             "Firefighters and aircraft worked to contain the flames while smoke drifted over nearby cities and closed several schools.",
             "Officials said the wildfire had destroyed homes and warned that dry weather could keep the forest fire burning for days."],
    "vote": ["The opposition party won the regional election with a clear majority, ending years of rule by the governing coalition.",
             "Turnout was high, and analysts described the election result as a surprise after opinion polls suggested a narrow win.",
             "The governing coalition leader conceded defeat and promised an orderly handover after the regional vote.",
             "The opposition leader said voters had asked for change and promised to focus on cost of living and public services."],
    "chip": ["The chipmaker unveiled a new AI processor designed for data centres and said it delivers faster training at lower power.",
             "Analysts said the launch raises pressure on rival semiconductor companies that dominate the market for AI chips.",
             "The processor will ship to cloud customers next quarter, and the company said early tests beat rival chips on several benchmarks.",
             "Shares in the chipmaker rose after the AI processor announcement while rival semiconductor stocks slipped."],
    "cricket": ["The national cricket team won the championship final after a dramatic last over, hitting a boundary off the final ball.",
                "Thousands of fans packed the stadium and celebrated the cricket championship with fireworks and street parties.",
                "The captain praised the bowlers and said the cricket final was decided by nerves in the last over.",
                "The champions returned home to a heroes welcome, with crowds lining the streets to greet the national cricket team."],
    "strike": ["Rail workers walked out on Monday in a dispute over pay, cancelling most commuter services across the country.",
               "Commuters were stranded at stations as trains stopped, and roads filled with traffic in major cities.",
               "The rail union said the strike would continue until the operator improves its pay offer, while the government urged talks.",
               "Businesses warned that the rail strike could cost millions each day as employees struggled to reach work."],
    "lunar": ["The lunar probe launch was postponed because of stormy weather at the spaceport, the space agency said.",
              "Engineers had completed final checks on the rocket, but a storm forecast forced managers to delay the lunar mission.",
              "A new launch window is expected within days if the weather improves at the spaceport.",
              "The lunar probe will study water ice near the moon's south pole once it reaches orbit."],
    "misc": ["The museum's dinosaur exhibition features life-size fossils, a walk-through skeleton hall and hands-on digging pits for children. Curators spent three years assembling the collection from private donors.",
             "Researchers tracked sleep schedules of several hundred volunteers and compared them with results on recall tasks. Participants who went to bed at irregular hours forgot more items than steady sleepers.",
             "The bakery has fed its neighbourhood since 1998 using a starter kept alive for more than two decades. Judges praised the crackling crust, open crumb and tangy flavour of the winning loaf."],
}

EXTRA_BODY = {
    "gamma-paywalled": "Subscribe to keep reading this story.",
    "gamma-broken": "",
    "beta-baddate": ("Volunteers turned an abandoned parking lot into a community garden with raised beds, a compost corner "
                     "and a small orchard. Neighbours plan to share the vegetables with a local food pantry every weekend."),
}

OUTLETS = {"alpha": "Alpha Daily", "beta": "Beta Times", "gamma": "Gamma Post"}


def _slug(key: str, i: int, outlet: str) -> str:
    return f"{outlet}-{key}-{i}"


def build_dataset(now: datetime) -> dict:
    """Return {'items': {outlet: [item,...]}, 'pages': {slug: (status, html)}}."""
    items: dict[str, list[dict]] = {"alpha": [], "beta": [], "gamma": []}
    pages: dict[str, tuple[int, str]] = {}
    for key, entries in STORIES.items():
        for i, (outlet, hours, headline, summary) in enumerate(entries):
            slug = _slug(key, i, outlet)
            when = now - timedelta(hours=hours)
            if key == "misc":
                paragraphs = [BODY["misc"][i], f"{OUTLETS[outlet]} reporting contributed to this article."]
            else:
                sentences = BODY[key]
                body = sentences[i % 4:] + sentences[: i % 4]
                paragraphs = [" ".join(body[:2]), " ".join(body[2:]),
                              f"{OUTLETS[outlet]} reporting contributed to this article."]
            page = ("<html><head><title>%s</title></head><body><header>Site menu Sign in</header>"
                    "<nav>Home World Sport</nav><article><h1>%s</h1>%s</article>"
                    "<footer>Copyright</footer></body></html>") % (
                html.escape(headline), html.escape(headline),
                "".join(f"<p>{html.escape(p)}</p>" for p in paragraphs))
            pages[slug] = (200, page)
            items[outlet].append({"slug": slug, "title": headline, "summary": summary, "when": when})
    # ---- awkward cases -------------------------------------------------
    pages["gamma-paywalled"] = (200, "<html><body><article><p>Subscribe to keep reading this story.</p></article></body></html>")
    items["gamma"].append({"slug": "gamma-paywalled", "title": "Exclusive interview with a retired diplomat",
                           "summary": "A retired diplomat talks about decades of negotiations.", "when": now - timedelta(hours=4)})
    pages["gamma-broken"] = (500, "server error")
    items["gamma"].append({"slug": "gamma-broken", "title": "Volunteers restore historic lighthouse on the island",
                           "summary": "Volunteers spent the summer repairing a historic lighthouse.", "when": None})
    pages["beta-baddate"] = (200, "<html><body><article><h1>Community garden</h1><p>%s</p></article></body></html>" % EXTRA_BODY["beta-baddate"])
    items["beta"].append({"slug": "beta-baddate", "title": "Community garden opens on former parking lot",
                          "summary": "Residents opened a community garden on a former parking lot.", "when": "not a real date"})
    return {"items": items, "pages": pages}


class _Handler(BaseHTTPRequestHandler):
    server: "MockNewsServer"

    def log_message(self, *args):  # silence
        pass

    def _send(self, status: int, body: str, ctype: str = "text/html; charset=utf-8"):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        srv = self.server
        path = self.path.split("?")[0]
        if path == "/feeds/alpha.xml":
            return self._send(200, srv.rss_alpha(), "application/rss+xml; charset=utf-8")
        if path == "/feeds/beta.xml":
            return self._send(200, srv.rss_beta(), "application/rss+xml; charset=utf-8")
        if path == "/feeds/gamma.xml":
            return self._send(200, srv.atom_gamma(), "application/atom+xml; charset=utf-8")
        if path == "/feeds/broken.xml":
            return self._send(500, "boom", "text/plain")
        if path.startswith("/articles/"):
            slug = path[len("/articles/"):].removesuffix(".html")
            status, page = srv.data["pages"].get(slug, (404, "not found"))
            return self._send(status, page)
        self._send(404, "not found", "text/plain")


class MockNewsServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int = 0, now: Optional[datetime] = None):
        super().__init__(("127.0.0.1", port), _Handler)
        self.now = now or datetime.now(timezone.utc)
        self.data = build_dataset(self.now)
        self._thread: Optional[threading.Thread] = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def start(self) -> "MockNewsServer":
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self.shutdown()
        self.server_close()

    def _link(self, slug: str) -> str:
        return f"{self.base_url}/articles/{slug}.html"

    # ---- format 1: classic RSS 2.0, <description> + RFC-822 dates -------------
    def rss_alpha(self) -> str:
        out = []
        for n, it in enumerate(self.data["items"]["alpha"]):
            when = it["when"]
            fmt = format_datetime(when, usegmt=True)
            if n == 3:  # a non-GMT zone name to exercise date normalisation
                fmt = when.astimezone(timezone(timedelta(hours=-5))).strftime("%a, %d %b %Y %H:%M:%S EST")
            out.append(f"<item><title>{html.escape(it['title'])}</title><link>{self._link(it['slug'])}</link>"
                       f"<guid isPermaLink='false'>{it['slug']}</guid><pubDate>{fmt}</pubDate>"
                       f"<description>&lt;p&gt;{html.escape(it['summary'])}&lt;/p&gt;</description></item>")
        first = self.data["items"]["alpha"][0]      # same story again with tracking parameters (duplicate)
        out.append(f"<item><title>{html.escape(first['title'])}</title>"
                   f"<link>{self._link(first['slug'])}?utm_source=rss&amp;at_medium=RSS</link>"
                   f"<pubDate>{format_datetime(first['when'], usegmt=True)}</pubDate>"
                   f"<description>{html.escape(first['summary'])}</description></item>")
        return f"<?xml version='1.0'?><rss version='2.0'><channel><title>Alpha Daily</title>{''.join(out)}</channel></rss>"

    # ---- format 2: RSS + content:encoded + Dublin Core ISO dates ---------------
    def rss_beta(self) -> str:
        out = []
        for it in self.data["items"]["beta"]:
            when = it["when"]
            date = when if isinstance(when, str) else when.strftime("%Y-%m-%dT%H:%M:%S+00:00")
            out.append(f"<item><title>{html.escape(it['title'])}</title><link>{self._link(it['slug'])}</link>"
                       f"<dc:date>{date}</dc:date>"
                       f"<content:encoded><![CDATA[<p>{html.escape(it['summary'])}</p>]]></content:encoded></item>")
        out.append("<item><title>Item without any link</title><description>broken entry</description></item>")
        return ("<?xml version='1.0'?><rss version='2.0' xmlns:dc='http://purl.org/dc/elements/1.1/' "
                "xmlns:content='http://purl.org/rss/1.0/modules/content/'><channel><title>Beta Times</title>"
                + "".join(out) + "</channel></rss>")

    # ---- format 3: Atom, <updated> only, some entries without any date ---------
    def atom_gamma(self) -> str:
        out = []
        for it in self.data["items"]["gamma"]:
            when = it["when"]
            date = f"<updated>{when.strftime('%Y-%m-%dT%H:%M:%SZ')}</updated>" if when else ""
            out.append(f"<entry><title>{html.escape(it['title'])}</title><link href='{self._link(it['slug'])}'/>"
                       f"<id>tag:gamma,{it['slug']}</id>{date}<summary>{html.escape(it['summary'])}</summary></entry>")
        return ("<?xml version='1.0' encoding='utf-8'?><feed xmlns='http://www.w3.org/2005/Atom'>"
                "<title>Gamma Post</title>" + "".join(out) + "</feed>")


def write_feeds_file(path, base_url: str, include_broken: bool = False) -> None:
    import json

    feeds = [
        {"name": "Alpha Daily", "url": f"{base_url}/feeds/alpha.xml", "enabled": True},
        {"name": "Beta Times", "url": f"{base_url}/feeds/beta.xml", "enabled": True},
        {"name": "Gamma Post", "url": f"{base_url}/feeds/gamma.xml", "enabled": True},
    ]
    if include_broken:
        feeds.append({"name": "Broken Feed", "url": f"{base_url}/feeds/broken.xml", "enabled": True})
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(feeds, fh, indent=2)


if __name__ == "__main__":
    import sys
    from pathlib import Path

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = MockNewsServer(port)
    target = Path(__file__).with_name("feeds.local.json")
    write_feeds_file(target, server.base_url, include_broken=True)
    print(f"Mock news wire on {server.base_url}  (feeds file written to {target})")
    print("Run the pipeline against it with:  FEEDS_FILE=scraper/devtools/feeds.local.json python -m scraper.run")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
