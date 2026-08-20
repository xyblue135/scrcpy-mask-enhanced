/*
 * This file is auto-generated.  DO NOT MODIFY.
 * Using: C:\Users\xyblu\AppData\Local\Android\Sdk\build-tools\35.0.0\aidl.exe -pC:\Users\xyblu\AppData\Local\Android\Sdk\platforms\android-34\framework.aidl -oD:\0_desktop\2_Frequently-Used\ Folders\scrcpy-mask-enhanced-xyblue\android-app\app\build\generated\aidl_source_output_dir\debug\out -ID:\0_desktop\2_Frequently-Used\ Folders\scrcpy-mask-enhanced-xyblue\android-app\app\src\main\aidl -ID:\0_desktop\2_Frequently-Used\ Folders\scrcpy-mask-enhanced-xyblue\android-app\app\src\debug\aidl -dC:\Users\xyblu\AppData\Local\Temp\aidl17587715634479472462.d D:\0_desktop\2_Frequently-Used\ Folders\scrcpy-mask-enhanced-xyblue\android-app\app\src\main\aidl\com\xyblue\k100mapper\IInputInjector.aidl
 */
package com.xyblue.k100mapper;
public interface IInputInjector extends android.os.IInterface
{
  /** Default implementation for IInputInjector. */
  public static class Default implements com.xyblue.k100mapper.IInputInjector
  {
    @Override public void destroy() throws android.os.RemoteException
    {
    }
    @Override public boolean injectTap(float x, float y, long durationMs) throws android.os.RemoteException
    {
      return false;
    }
    @Override public boolean injectSwipe(float x1, float y1, float x2, float y2, long durationMs) throws android.os.RemoteException
    {
      return false;
    }
    @Override public java.lang.String status() throws android.os.RemoteException
    {
      return null;
    }
    @Override
    public android.os.IBinder asBinder() {
      return null;
    }
  }
  /** Local-side IPC implementation stub class. */
  public static abstract class Stub extends android.os.Binder implements com.xyblue.k100mapper.IInputInjector
  {
    /** Construct the stub at attach it to the interface. */
    @SuppressWarnings("this-escape")
    public Stub()
    {
      this.attachInterface(this, DESCRIPTOR);
    }
    /**
     * Cast an IBinder object into an com.xyblue.k100mapper.IInputInjector interface,
     * generating a proxy if needed.
     */
    public static com.xyblue.k100mapper.IInputInjector asInterface(android.os.IBinder obj)
    {
      if ((obj==null)) {
        return null;
      }
      android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
      if (((iin!=null)&&(iin instanceof com.xyblue.k100mapper.IInputInjector))) {
        return ((com.xyblue.k100mapper.IInputInjector)iin);
      }
      return new com.xyblue.k100mapper.IInputInjector.Stub.Proxy(obj);
    }
    @Override public android.os.IBinder asBinder()
    {
      return this;
    }
    @Override public boolean onTransact(int code, android.os.Parcel data, android.os.Parcel reply, int flags) throws android.os.RemoteException
    {
      java.lang.String descriptor = DESCRIPTOR;
      if (code >= android.os.IBinder.FIRST_CALL_TRANSACTION && code <= android.os.IBinder.LAST_CALL_TRANSACTION) {
        data.enforceInterface(descriptor);
      }
      if (code == INTERFACE_TRANSACTION) {
        reply.writeString(descriptor);
        return true;
      }
      switch (code)
      {
        case TRANSACTION_destroy:
        {
          this.destroy();
          reply.writeNoException();
          break;
        }
        case TRANSACTION_injectTap:
        {
          float _arg0;
          _arg0 = data.readFloat();
          float _arg1;
          _arg1 = data.readFloat();
          long _arg2;
          _arg2 = data.readLong();
          boolean _result = this.injectTap(_arg0, _arg1, _arg2);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          break;
        }
        case TRANSACTION_injectSwipe:
        {
          float _arg0;
          _arg0 = data.readFloat();
          float _arg1;
          _arg1 = data.readFloat();
          float _arg2;
          _arg2 = data.readFloat();
          float _arg3;
          _arg3 = data.readFloat();
          long _arg4;
          _arg4 = data.readLong();
          boolean _result = this.injectSwipe(_arg0, _arg1, _arg2, _arg3, _arg4);
          reply.writeNoException();
          reply.writeInt(((_result)?(1):(0)));
          break;
        }
        case TRANSACTION_status:
        {
          java.lang.String _result = this.status();
          reply.writeNoException();
          reply.writeString(_result);
          break;
        }
        default:
        {
          return super.onTransact(code, data, reply, flags);
        }
      }
      return true;
    }
    private static class Proxy implements com.xyblue.k100mapper.IInputInjector
    {
      private android.os.IBinder mRemote;
      Proxy(android.os.IBinder remote)
      {
        mRemote = remote;
      }
      @Override public android.os.IBinder asBinder()
      {
        return mRemote;
      }
      public java.lang.String getInterfaceDescriptor()
      {
        return DESCRIPTOR;
      }
      @Override public void destroy() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_destroy, _data, _reply, 0);
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      @Override public boolean injectTap(float x, float y, long durationMs) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeFloat(x);
          _data.writeFloat(y);
          _data.writeLong(durationMs);
          boolean _status = mRemote.transact(Stub.TRANSACTION_injectTap, _data, _reply, 0);
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public boolean injectSwipe(float x1, float y1, float x2, float y2, long durationMs) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        boolean _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeFloat(x1);
          _data.writeFloat(y1);
          _data.writeFloat(x2);
          _data.writeFloat(y2);
          _data.writeLong(durationMs);
          boolean _status = mRemote.transact(Stub.TRANSACTION_injectSwipe, _data, _reply, 0);
          _reply.readException();
          _result = (0!=_reply.readInt());
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public java.lang.String status() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        java.lang.String _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_status, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readString();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
    }
    static final int TRANSACTION_destroy = (android.os.IBinder.FIRST_CALL_TRANSACTION + 16777114);
    static final int TRANSACTION_injectTap = (android.os.IBinder.FIRST_CALL_TRANSACTION + 1);
    static final int TRANSACTION_injectSwipe = (android.os.IBinder.FIRST_CALL_TRANSACTION + 2);
    static final int TRANSACTION_status = (android.os.IBinder.FIRST_CALL_TRANSACTION + 3);
  }
  /** @hide */
  public static final java.lang.String DESCRIPTOR = "com.xyblue.k100mapper.IInputInjector";
  public void destroy() throws android.os.RemoteException;
  public boolean injectTap(float x, float y, long durationMs) throws android.os.RemoteException;
  public boolean injectSwipe(float x1, float y1, float x2, float y2, long durationMs) throws android.os.RemoteException;
  public java.lang.String status() throws android.os.RemoteException;
}
