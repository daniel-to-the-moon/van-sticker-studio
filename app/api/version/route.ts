import { currentBuildInfo } from '@/lib/build-info';
export function GET() {
  return Response.json(currentBuildInfo(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
