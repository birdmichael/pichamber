const ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const randomBase62 = (length) => {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return result;
};

let lastTimestamp = 0;
let counter = 0;

export const createId = (prefix) => {
  const timestamp = Date.now();
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  }
  counter += 1;
  const sortable = BigInt(timestamp) * BigInt(0x1000) + BigInt(counter);
  const hex = sortable.toString(16).padStart(12, '0').slice(-12);
  return `${prefix}_${hex}${randomBase62(10)}`;
};

export const createSessionId = () => createId('ses');
export const createMessageId = () => createId('msg');
export const createPartId = () => createId('prt');
export const createEventId = () => createId('evt');
