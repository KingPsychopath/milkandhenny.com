import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BlogPostPage(_props: Props) {
  notFound();
}
