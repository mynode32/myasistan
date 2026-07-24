"use client";

import { useEffect, useState } from "react";

type Variant = { id: string; price: string; stockQuantity: number };
type Product = { id: string; title: string; brand: string | null; variants: Variant[] };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProducts() {
    const response = await fetch("/api/products");
    const data = await response.json();
    setProducts(data.products ?? []);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  async function handleAddProduct(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        variants: [{ price: Number(price), stockQuantity: Number(stock) }],
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(JSON.stringify(data.error));
      return;
    }

    setTitle("");
    setPrice("");
    setStock("0");
    await loadProducts();
  }

  async function handleCsvImport(event: React.FormEvent) {
    event.preventDefault();
    setImportMessage(null);
    if (!csvFile) {
      return;
    }

    const formData = new FormData();
    formData.append("file", csvFile);

    const response = await fetch("/api/products/import", { method: "POST", body: formData });
    const data = await response.json();
    setImportMessage(`İçe aktarılan: ${data.imported}, başarısız: ${data.failed}`);
    await loadProducts();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Ürünler</h1>

      <form onSubmit={handleAddProduct} className="flex flex-wrap items-end gap-3 rounded border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-sm text-gray-700">Ürün Adı</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700">Fiyat</label>
          <input
            required
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700">Stok</label>
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="w-20 rounded border border-gray-300 px-2 py-1"
          />
        </div>
        <button type="submit" className="rounded bg-gray-900 px-3 py-2 text-white">
          Ürün Ekle
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <form onSubmit={handleCsvImport} className="flex items-center gap-3 rounded border border-gray-200 bg-white p-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="rounded bg-gray-700 px-3 py-2 text-white">
          CSV İçe Aktar
        </button>
        {importMessage && <p className="text-sm text-gray-700">{importMessage}</p>}
      </form>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-2">Ürün</th>
            <th className="py-2">Marka</th>
            <th className="py-2">Fiyat</th>
            <th className="py-2">Stok</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-gray-100">
              <td className="py-2">{product.title}</td>
              <td className="py-2">{product.brand ?? "-"}</td>
              <td className="py-2">{product.variants[0]?.price ?? "-"}</td>
              <td className="py-2">{product.variants[0]?.stockQuantity ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
