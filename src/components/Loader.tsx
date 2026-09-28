/** Animated spinning loader shown while data is being fetched. */
export default function Loader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-600 border-t-blue-400" />
    </div>
  );
}
