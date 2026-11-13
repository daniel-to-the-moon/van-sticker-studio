import Link from 'next/link';
import WrapDesignStudio from '@/components/studio/WrapDesignStudio';

export default function DesignPage() {
  return (
    <>
      <nav aria-label='应用导航' className='bg-gray-900 text-white px-6 py-3'>
        <Link href='/interior-layout' className='text-sm hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-gray-900 rounded'>室内布局（示例）</Link>
      </nav>
      <WrapDesignStudio />
    </>
  );
}
