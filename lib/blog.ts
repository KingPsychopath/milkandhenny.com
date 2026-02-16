import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { uniqueHeadingIds } from "@/lib/slug";

const POSTS_DIR = path.join(process.cwd(), "content/posts");
const SAFE_POST_SLUG = /^[a-z0-9-]+$/;

/** Average reading speed in words per minute */
const WPM = 230;

/** Frontmatter shape for blog posts */
type PostFrontmatter = {
  title: string;
  date: string;
  subtitle?: string;
  image?: string;
  /** Pin to top of homepage when true */
  featured?: boolean;
};

/** A parsed blog post */
type Post = PostFrontmatter & {
  slug: string;
  content: string;
  /** Estimated reading time in minutes */
  readingTime: number;
};

/** Plain-text excerpt for search (markdown stripped, ~500 chars) */
function toSearchText(content: string, maxLen = 500): string {
  return content
    .replace(/^---[\s\S]*?---/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/#[^\s]+/g, "")
    .replace(/[*_`#\[\]()]/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** Calculate estimated reading time from raw markdown content */
function estimateReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / WPM));
}

/** Read and parse a single markdown file by slug */
function getPostBySlug(slug: string): Post | null {
  if (!SAFE_POST_SLUG.test(slug)) return null;
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
    featured: frontmatter.featured ?? false,
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

/** Get up to N most recent posts. Featured first, then by date. */
function getRecentPosts(limit: number): Post[] {
  const all = getAllPosts();
  const featured = all.filter((p) => p.featured);
  const rest = all.filter((p) => !p.featured);
  const merged = [...featured, ...rest];
  return merged.slice(0, limit);
}

/** Minimal post data for blog index + search. Includes searchable text. */
export type BlogPostSummary = {
  slug: string;
  title: string;
  date: string;
  subtitle?: string;
  readingTime: number;
  featured: boolean;
  searchText: string;
};

function getBlogPostSummaries(): BlogPostSummary[] {
  return getAllPosts().map((post) => ({
    slug: post.slug,
    title: post.title,
    date: post.date,
    subtitle: post.subtitle,
    readingTime: post.readingTime,
    featured: post.featured ?? false,
    searchText: [
      post.title,
      post.subtitle ?? "",
      toSearchText(post.content),
    ].join(" "),
  }));
}

/** Get all slugs for static generation */
function getAllSlugs(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

/** TOC item for jump rail: id matches rehype-slug on h1/h2/h3 */
export type HeadingItem = { id: string; label: string };

/** Extract h1/h2/h3 labels from markdown in order; ids match rehype-slug. */
function extractHeadings(content: string): HeadingItem[] {
  const labels: string[] = [];
  const lineRe = /^(#{1,3})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(content)) !== null) {
    labels.push(m[2].trim());
  }
  return uniqueHeadingIds(labels);
}

export { getPostBySlug, getAllPosts, getAllSlugs, getRecentPosts, getBlogPostSummaries, extractHeadings };
export type { Post, PostFrontmatter };
