import { docs } from '@/lib/docs';

/*
 * `/` is the documentation's own index, because the docs are mounted at the
 * root — `docs.wave.so` is documentation and nothing else, so `content/index.md`
 * is the home page rather than something to redirect away from.
 *
 * This file used to be a `<meta http-equiv="refresh">` to `/docs`, which was
 * itself a repair of a `redirect()` that could not survive a static export.
 * Both are gone: there is nothing to redirect to any more.
 */
export default docs.IndexPage;
export const generateMetadata = docs.generateMetadata;
