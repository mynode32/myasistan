const CHAT_MODEL = "gpt-4o-mini";

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

export async function generateGroundedAnswer(question: string, context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY tanımlı değil.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Yalnızca verilen bağlamdaki bilgilere dayanarak Türkçe cevap ver. Bağlamda cevap yoksa bunu açıkça söyle. Fiyat, stok, iade, kargo veya garanti bilgisi için bağlam dışında iddia üretme.",
        },
        {
          role: "user",
          content: `Bağlam:\n${context}\n\nSoru:\n${question}`,
        },
      ],
    }),
  });

  const data = (await response.json()) as ChatResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? "Cevap oluşturulamadı.");
  }

  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error("Cevap yanıtı boş döndü.");
  }

  return answer;
}
