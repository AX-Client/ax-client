import { useEffect, useState } from "react";
import { Newspaper, ExternalLink, Clock } from "lucide-react";
import { api, toast } from "../lib/api";
import type { NewsItem } from "../lib/types";
import { Card, EmptyState, RefreshButton, SpinnerBlock } from "../components/ui";
import { useT } from "../lib/i18n";

export default function NewsPage() {
  const t = useT();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = (quiet?: boolean) => {
    if (!quiet) setLoading(true);
    setRefreshing(!!quiet);
    api
      .newsFeed()
      .then(setItems)
      .catch((e) => toast(e))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("news.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("news.sub")}
          </p>
        </div>
        <RefreshButton onClick={() => load(true)} loading={refreshing} title={t("common.refresh")} />
      </div>

      {loading ? (
        <SpinnerBlock label={t("news.loading")} />
      ) : items.length === 0 ? (
        <Card className="p-10">
          <EmptyState
            icon={<Newspaper className="w-5 h-5" />}
            title={t("news.emptyTitle")}
            body={t("news.emptyBody")}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((n, i) => (
            <Card key={i} className="p-5 group">
              <a
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className="block"
                onClick={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/35 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {n.date ? new Date(n.date).toLocaleDateString() : t("news.brand")}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-white/25 group-hover:text-accent transition" />
                </div>
                <h2 className="mt-2 text-[15px] font-semibold text-white group-hover:text-accent transition leading-snug">
                  {n.title}
                </h2>
                {n.description && (
                  <p className="mt-1.5 text-[12px] text-white/45 line-clamp-2 leading-relaxed">
                    {n.description}
                  </p>
                )}
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}