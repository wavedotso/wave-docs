import { docs } from '@/lib/docs';

/*
 * The whole docs shell. Next passes `{ children, params }`; `docs.Layout`
 * declares only `children` and the extra is ignored, which is what makes this
 * one-liner type-check as a layout.
 */
export default docs.Layout;
