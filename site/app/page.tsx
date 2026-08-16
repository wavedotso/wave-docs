import { redirect } from 'next/navigation';

/**
 * The site is only documentation, so `/` is `/docs`.
 *
 * A redirect rather than a copy of the index page: two URLs serving identical
 * HTML is the duplicate-content problem `[[...slug]]` was rejected for, and it
 * would be odd to make the site commit the mistake the README warns about.
 */
export default function Home(): never {
  redirect('/docs');
}
