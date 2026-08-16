import '@waveso/docs/styles.css';
import { docs } from '@/lib/docs';

/*
 * The whole shell, and the whole point of this site: one line, no CSS of its
 * own, no wrapper. If a page here ever needs a layout rule that is not in the
 * package, that is a defect in the package rather than a thing to add locally.
 */
export default docs.Layout;
