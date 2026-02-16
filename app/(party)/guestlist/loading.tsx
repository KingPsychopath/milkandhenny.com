export default function Loading() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 relative">
          <div className="absolute inset-0 rounded-full border-4 border-amber-200" />
          <div className="absolute inset-0 rounded-full border-4 border-amber-600 border-t-transparent animate-spin" />
        </div>
        <p className="text-stone-600 font-medium">Loading guest list...</p>
      </div>
    </div>
  );
}
