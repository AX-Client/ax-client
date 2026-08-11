use crate::error::{Error, Result};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

const TAG_END: u8 = 0;
const TAG_BYTE: u8 = 1;
const TAG_SHORT: u8 = 2;
const TAG_INT: u8 = 3;
const TAG_LONG: u8 = 4;
const TAG_FLOAT: u8 = 5;
const TAG_DOUBLE: u8 = 6;
const TAG_BYTE_ARRAY: u8 = 7;
const TAG_STRING: u8 = 8;
const TAG_LIST: u8 = 9;
const TAG_COMPOUND: u8 = 10;
const TAG_INT_ARRAY: u8 = 11;
const TAG_LONG_ARRAY: u8 = 12;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    IntArray(Vec<i64>),
    LongArray(Vec<i64>),
    String(String),
    List(Vec<Value>),
    Compound(HashMap<String, Value>),
}

impl Value {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Byte(b) => Some(*b as i64),
            Value::Short(s) => Some(*s as i64),
            Value::Int(i) => Some(*i as i64),
            Value::Long(l) => Some(*l),
            _ => None,
        }
    }

    pub fn compound(&self) -> Option<&HashMap<String, Value>> {
        match self {
            Value::Compound(m) => Some(m),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.compound().and_then(|m| m.get(key))
    }

    /// Parse the general NBT of Minecraft's `level.dat` (gzip, no header).
    pub fn read_gzip(path: &std::path::Path) -> Result<Value> {
        let file = std::fs::read(path)?;
        Self::read_from_bytes(file)
    }

    /// Read NBT from a file that may be gzip-compressed or plain (servers.dat).
    pub fn read_auto(path: &std::path::Path) -> Result<Value> {
        let file = std::fs::read(path)?;
        if file.starts_with(&[0x1f, 0x8b]) {
            Self::read_from_bytes(file)
        } else {
            Self::read_plain(&file)
        }
    }

    /// Read a named root NBT tag (tag type byte + name + payload).
    fn parse_named(data: &[u8]) -> Result<Value> {
        if data.len() < 4 {
            return Err(Error::Io(format!("NBT file too small: {} bytes", data.len())));
        }
        let tag = data[0];
        let name_len = i16::from_be_bytes([data[1], data[2]]) as usize;
        let mut pos = 1 + 2 + name_len;
        let tag = if tag == TAG_END { TAG_COMPOUND } else { tag };
        let mut reader = Reader { data, pos };
        let value = reader.read_tag(tag)?;
        Ok(value)
    }

    fn read_plain(data: &[u8]) -> Result<Value> {
        Self::parse_named(data)
    }

    fn read_from_bytes(file: Vec<u8>) -> Result<Value> {
        let mut decoder = GzDecoder::new(Cursor::new(file));
        let mut buf = Vec::new();
        decoder.read_to_end(&mut buf)?;
        Self::parse_named(&buf)
    }
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn bytes(&mut self, n: usize) -> Result<Vec<u8>> {
        if self.pos + n > self.data.len() {
            return Err(Error::Io(format!("NBT read out of bounds at {}", self.pos)));
        }
        let b = self.data[self.pos..self.pos + n].to_vec();
        self.pos += n;
        Ok(b)
    }

    fn read_tag(&mut self, tag: u8) -> Result<Value> {
        match tag {
            TAG_END => Ok(Value::Byte(0)),
            TAG_BYTE => {
                let b = self.bytes(1)?;
                Ok(Value::Byte(b[0] as i8))
            }
            TAG_SHORT => {
                let b = self.bytes(2)?;
                Ok(Value::Short(i16::from_be_bytes([b[0], b[1]])))
            }
            TAG_INT => {
                let b = self.bytes(4)?;
                Ok(Value::Int(i32::from_be_bytes([b[0], b[1], b[2], b[3]])))
            }
            TAG_LONG => {
                let b = self.bytes(8)?;
                Ok(Value::Long(i64::from_be_bytes([
                    b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
                ])))
            }
            TAG_FLOAT => {
                let b = self.bytes(4)?;
                Ok(Value::Float(f32::from_be_bytes([b[0], b[1], b[2], b[3]])))
            }
            TAG_DOUBLE => {
                let b = self.bytes(8)?;
                Ok(Value::Double(f64::from_be_bytes([
                    b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
                ])))
            }
            TAG_BYTE_ARRAY => {
                let len = self.read_tag(TAG_INT)?;
                let len = len.as_i64().unwrap_or(0) as usize;
                let _b = self.bytes(len)?;
                Ok(Value::IntArray(vec![]))
            }
            // NOTE: byte arrays are rarely read by this launcher; the raw
            // contents are not retained to keep memory use low for icons.
            TAG_STRING => {
                let len = self.read_tag(TAG_SHORT)?;
                let len = len.as_i64().unwrap_or(0) as usize;
                let b = self.bytes(len)?;
                Ok(Value::String(String::from_utf8_lossy(&b).to_string()))
            }
            TAG_LIST => {
                let elem = self.bytes(1)?[0];
                let len = self.read_tag(TAG_INT)?;
                let len = len.as_i64().unwrap_or(0) as usize;
                let mut items = Vec::with_capacity(len.min(1_000_000));
                for _ in 0..len {
                    items.push(self.read_tag(elem)?);
                }
                Ok(Value::List(items))
            }
            TAG_COMPOUND => {
                let mut map = HashMap::new();
                loop {
                    let t = self.bytes(1)?[0];
                    if t == TAG_END {
                        break;
                    }
                    let name = match self.read_tag(TAG_STRING)? {
                        Value::String(s) => s,
                        _ => return Err(Error::Io("bad compound key".into())),
                    };
                    let v = self.read_tag(t)?;
                    map.insert(name, v);
                }
                Ok(Value::Compound(map))
            }
            TAG_INT_ARRAY => {
                let len = self.read_tag(TAG_INT)?;
                let len = len.as_i64().unwrap_or(0) as usize;
                let mut out = Vec::with_capacity(len.min(1_000_000));
                for _ in 0..len {
                    out.push(self.read_tag(TAG_INT)?.as_i64().unwrap_or(0));
                }
                Ok(Value::IntArray(out))
            }
            TAG_LONG_ARRAY => {
                let len = self.read_tag(TAG_INT)?;
                let len = len.as_i64().unwrap_or(0) as usize;
                let mut out = Vec::with_capacity(len.min(1_000_000));
                for _ in 0..len {
                    out.push(self.read_tag(TAG_LONG)?.as_i64().unwrap_or(0));
                }
                Ok(Value::LongArray(out))
            }
            _ => Err(Error::Io(format!("unknown NBT tag {tag}"))),
        }
    }
}

// --------------------------------------------------------------------------
// Writing
// --------------------------------------------------------------------------

fn tag_of(v: &Value) -> u8 {
    match v {
        Value::Byte(_) => TAG_BYTE,
        Value::Short(_) => TAG_SHORT,
        Value::Int(_) => TAG_INT,
        Value::Long(_) => TAG_LONG,
        Value::Float(_) => TAG_FLOAT,
        Value::Double(_) => TAG_DOUBLE,
        Value::IntArray(_) => TAG_INT_ARRAY,
        Value::LongArray(_) => TAG_LONG_ARRAY,
        Value::String(_) => TAG_STRING,
        Value::List(_) => TAG_LIST,
        Value::Compound(_) => TAG_COMPOUND,
        Value::ByteArray(_) => TAG_BYTE_ARRAY,
    }
}

fn write_value(out: &mut Vec<u8>, v: &Value, depth: usize) {
    if depth > 512 {
        return;
    }
    match v {
        Value::Byte(b) => out.push(*b as u8),
        Value::Short(s) => out.extend_from_slice(&s.to_be_bytes()),
        Value::Int(i) => out.extend_from_slice(&i.to_be_bytes()),
        Value::Long(l) => out.extend_from_slice(&l.to_be_bytes()),
        Value::Float(f) => out.extend_from_slice(&f.to_be_bytes()),
        Value::Double(d) => out.extend_from_slice(&d.to_be_bytes()),
        Value::IntArray(a) => {
            out.extend_from_slice(&(a.len() as i32).to_be_bytes());
            for x in a {
                out.extend_from_slice(&(*x as i32).to_be_bytes());
            }
        }
        Value::LongArray(a) => {
            out.extend_from_slice(&(a.len() as i32).to_be_bytes());
            for x in a {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
        Value::String(s) => {
            let bytes = s.as_bytes();
            let n = bytes.len().min(32767) as u16;
            out.extend_from_slice(&n.to_be_bytes());
            out.extend_from_slice(&bytes[..n as usize]);
        }
        Value::List(items) => {
            let elem_tag = items.first().map(tag_of).unwrap_or(TAG_END);
            out.push(elem_tag);
            out.extend_from_slice(&(items.len() as i32).to_be_bytes());
            for it in items {
                write_value(out, it, depth + 1);
            }
        }
        Value::Compound(map) => {
            for (k, val) in map {
                out.push(tag_of(val));
                let bytes = k.as_bytes();
                let n = bytes.len().min(32767) as u16;
                out.extend_from_slice(&n.to_be_bytes());
                out.extend_from_slice(&bytes[..n as usize]);
                write_value(out, val, depth + 1);
            }
            out.push(TAG_END);
        }
        Value::ByteArray(a) => {
            out.extend_from_slice(&(a.len() as i32).to_be_bytes());
            for b in a {
                out.push(*b as u8);
            }
        }
    }
}

/// Write NBT as plain (uncompressed) root compound — matches how modern
/// Minecraft stores servers.dat.
pub fn write_plain(path: &std::path::Path, root_name: &str, root: &Value) -> Result<()> {
    let mut buf: Vec<u8> = Vec::new();
    buf.push(TAG_COMPOUND);
    let bytes = root_name.as_bytes();
    let n = bytes.len().min(32767) as u16;
    buf.extend_from_slice(&n.to_be_bytes());
    buf.extend_from_slice(&bytes[..n as usize]);
    write_value(&mut buf, root, 0);
    std::fs::write(path, buf)?;
    Ok(())
}

pub fn write_gzip(path: &std::path::Path, root_name: &str, root: &Value) -> Result<()> {
    let mut buf: Vec<u8> = Vec::new();
    buf.push(TAG_COMPOUND);
    let bytes = root_name.as_bytes();
    let n = bytes.len().min(32767) as u16;
    buf.extend_from_slice(&n.to_be_bytes());
    buf.extend_from_slice(&bytes[..n as usize]);
    write_value(&mut buf, root, 0);

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&buf)?;
    let compressed = encoder.finish()?;
    std::fs::write(path, compressed)?;
    Ok(())
}