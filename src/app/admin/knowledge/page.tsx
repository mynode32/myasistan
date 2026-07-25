"use client";

import { useCallback, useEffect, useState } from "react";

type SourceType =
  | "FAQ"
  | "SHIPPING_POLICY"
  | "RETURN_POLICY"
  | "WARRANTY"
  | "CAMPAIGN"
  | "BLOG"
  | "CUSTOM";

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  FAQ: "SSS",
  SHIPPING_POLICY: "Kargo Politikası",
  RETURN_POLICY: "İade Politikası",
  WARRANTY: "Garanti",
  CAMPAIGN: "Kampanya",
  BLOG: "Blog / Rehber",
  CUSTOM: "Özel Not",
};

const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABELS) as SourceType[];

function errorMessage(error: unknown, fallback: string) {
  return typeof error === "string" ? error : fallback;
}

type KnowledgeDocument = {
  id: string;
  sourceType: SourceType;
  title: string;
  content: string;
  updatedAt: string;
};

type RagSource = {
  sourceType: SourceType;
  sourceId: string;
  content: string;
};

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>("FAQ");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<RagSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch("/api/knowledge");
      const data = await response.json();
      if (!response.ok) {
        setError(errorMessage(data.error, "Dokümanlar getirilemedi."));
        return;
      }
      setDocuments(data.documents ?? []);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocuments();
  }, [loadDocuments]);

  async function handleAddDocument(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, title, content, language: "tr" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(errorMessage(data.error, "Bilgi dokümanı eklenemedi."));
        return;
      }

      setTitle("");
      setContent("");
      await loadDocuments();
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setAnswer(null);
    setSources([]);
    setIsAsking(true);

    try {
      const response = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(errorMessage(data.error, "Cevap oluşturulamadı."));
        return;
      }

      setAnswer(data.answer);
      setSources(data.sources ?? []);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Bilgi Bankası</h1>
        <p className="text-sm text-gray-600">Ürünler otomatik eklenir; politika, SSS ve kampanya bilgilerini buradan girin.</p>
      </header>

      <form onSubmit={handleAddDocument} className="space-y-4 rounded border border-gray-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <div>
            <label className="block text-sm text-gray-700">Kaynak Tipi</label>
            <select
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as SourceType)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SOURCE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-700">Başlık</label>
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-700">İçerik</label>
          <textarea
            required
            maxLength={20000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={8}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-60"
          >
            {isSaving ? "Kaydediliyor" : "Bilgi Ekle"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Dokümanlar</h2>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2">Başlık</th>
              <th className="py-2">Tip</th>
              <th className="py-2">Güncelleme</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-b border-gray-100">
                <td className="py-2">{document.title}</td>
                <td className="py-2">{SOURCE_TYPE_LABELS[document.sourceType] ?? document.sourceType}</td>
                <td className="py-2">{new Date(document.updatedAt).toLocaleString("tr-TR")}</td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td className="py-4 text-gray-500" colSpan={3}>
                  Henüz manuel bilgi dokümanı yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <form onSubmit={handleAsk} className="space-y-4 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold">Soru Sor</h2>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            required
            maxLength={500}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Örn. İade süresi kaç gün?"
            className="flex-1 rounded border border-gray-300 px-2 py-2"
          />
          <button
            type="submit"
            disabled={isAsking}
            className="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-60"
          >
            {isAsking ? "Soruluyor" : "Sor"}
          </button>
        </div>
        {answer && (
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <p className="text-sm leading-6 text-gray-900">{answer}</p>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700">Kullanılan kaynaklar</h3>
              {sources.map((source, index) => (
                <div key={`${source.sourceId}-${index}`} className="rounded border border-gray-200 p-3 text-xs text-gray-600">
                  <div className="mb-1 font-medium text-gray-800">
                    {SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}
                  </div>
                  <p className="line-clamp-3">{source.content}</p>
                </div>
              ))}
              {sources.length === 0 && <p className="text-sm text-gray-500">Kaynak bulunamadı.</p>}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
