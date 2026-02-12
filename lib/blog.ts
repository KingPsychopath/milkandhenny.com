import fs from "fs";
import path from "path";
import matter from "gray-matter";

const POSTS_DIR = path.join(process.cwd(), "content/posts");

/** Average reading speed in words per minute */
const WPM = 230;

/** Frontmatter shape for blog posts */
type PostFrontmatter = {
  title: string;
  date: string;
  subtitle?: string;
  image?: string;
};

/** A parsed blog post */
type Post = PostFrontmatter & {
  slug: string;
  content: string;
  /** Estimated reading time in minutes */
  readingTime: number;
};

/** Calculate estimated reading time from raw markdown content */
function estimateReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / WPM));
}

/** Read and parse a single markdown file by slug */
function getPostBySlug(slug: string): Post | null {
  const filePath = path.join(POSTS_DIR, `${slug}.md`);

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const frontmatter = data as PostFrontmatter;

  return {
    slug,
    content,
    title: frontmatter.title,
    date: frontmatter.date,
    subtitle: frontmatter.subtitle,
    image: frontmatter.image,
    readingTime: estimateReadingTime(content),
  };
}

/** Get all posts sorted by date (newest first) */
function getAllPosts(): Post[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));

  const posts = files
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      return getPostBySlug(slug);
    })
    .filter((p): p is Post => p !== null);

  return posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/** Get all slugs for static generation */
function getAllSlugs(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

export { getPostBySlug, getAllPosts, getAllSlugs };
export type { Post, PostFrontmatter };
