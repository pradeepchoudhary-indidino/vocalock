package org.vosk;

import java.io.IOException;
import com.sun.jna.PointerType;

public class Model extends PointerType implements AutoCloseable {
    public Model() {
    }

    public Model(String path) throws IOException {
        super(LibVosk.vosk_model_new(path));

        if (getPointer() == null) {
            throw new IOException("Failed to create a model");
        }
    }

    /**
     * The word's symbol id if this model can recognise it, -1 if it is not in
     * the vocabulary. Added here: the upstream binding leaves it out, though
     * libvosk.so exports it.
     */
    public int findWord(String word) {
        return LibVosk.vosk_model_find_word(this.getPointer(), word);
    }

    @Override
    public void close() {
        LibVosk.vosk_model_free(this.getPointer());
    }
}
