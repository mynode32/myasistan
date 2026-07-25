export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-6 flex gap-4 text-sm">
          <a className="text-gray-700 hover:text-gray-950" href="/admin/products">
            Ürünler
          </a>
          <a className="text-gray-700 hover:text-gray-950" href="/admin/knowledge">
            Bilgi Bankası
          </a>
        </nav>
        {children}
      </div>
    </div>
  );
}
